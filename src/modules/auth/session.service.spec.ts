import { SpaceMember, User } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { SessionService } from './session.service';

const NOW_SECONDS = 1_700_000_000;

describe('SessionService', () => {
  const user = {
    id: 1,
    email: 'owner@example.com',
    isActive: true,
    profileCompleted: true,
    lastSpaceId: 'space-1',
  } as User;
  const member = {
    id: 'member-1',
    spaceId: 'space-1',
    userId: 1,
    role: 'admin',
  } as SpaceMember;
  const context = { userAgent: 'jest', ip: '127.0.0.1' };

  let jwtService: { sign: jest.Mock; verify: jest.Mock; decode: jest.Mock };
  let configService: { get: jest.Mock };
  let authTokenAccessor: {
    create: jest.Mock;
    rotateRefresh: jest.Mock;
    revoke: jest.Mock;
    revokeAllByUserAndPurpose: jest.Mock;
  };
  let userAccessor: { findById: jest.Mock; setLastSpaceId: jest.Mock };
  let spaceMemberAccessor: {
    findBySpaceAndUser: jest.Mock;
    findLatestByUserId: jest.Mock;
  };
  let service: SessionService;

  beforeEach(() => {
    jwtService = {
      sign: jest
        .fn()
        .mockImplementation(
          (_payload: unknown, opts: { secret: string }) =>
            `signed-with-${opts.secret}`,
        ),
      verify: jest.fn(),
      decode: jest.fn().mockReturnValue({ exp: NOW_SECONDS }),
    };
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          JWT_SECRET: 'access-secret',
          JWT_EXPIRES_IN: '15m',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_REFRESH_EXPIRES_IN: '7d',
        };
        return values[key];
      }),
    };
    authTokenAccessor = {
      create: jest.fn().mockResolvedValue({ id: 'token-1' }),
      rotateRefresh: jest.fn(),
      revoke: jest.fn().mockResolvedValue(true),
      revokeAllByUserAndPurpose: jest.fn().mockResolvedValue(2),
    };
    userAccessor = {
      findById: jest.fn().mockResolvedValue(user),
      setLastSpaceId: jest.fn().mockResolvedValue(user),
    };
    spaceMemberAccessor = {
      findBySpaceAndUser: jest.fn().mockResolvedValue(member),
      findLatestByUserId: jest.fn().mockResolvedValue(member),
    };
    service = new SessionService(
      jwtService as never,
      configService as never,
      authTokenAccessor as never,
      userAccessor as never,
      spaceMemberAccessor as never,
    );
  });

  describe('loadActiveMembership', () => {
    it('rejects a deactivated account', async () => {
      userAccessor.findById.mockResolvedValue({ ...user, isActive: false });

      await expect(service.loadActiveMembership(1)).resolves.toBeNull();
      expect(spaceMemberAccessor.findLatestByUserId).not.toHaveBeenCalled();
    });

    it('returns the user with no membership when it belongs to no space', async () => {
      spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue(null);
      spaceMemberAccessor.findLatestByUserId.mockResolvedValue(null);

      await expect(service.loadActiveMembership(1)).resolves.toEqual({
        user,
        member: null,
      });
    });

    describe('which space it resolves', () => {
      const other = { ...member, spaceId: 'space-2' };
      const latest = { ...member, spaceId: 'space-3' };
      const memberOf = (...spaceIds: string[]) =>
        spaceMemberAccessor.findBySpaceAndUser.mockImplementation(
          (spaceId: string) =>
            Promise.resolve(
              [member, other].find(
                (m) => m.spaceId === spaceId && spaceIds.includes(spaceId),
              ) ?? null,
            ),
        );

      beforeEach(() => {
        spaceMemberAccessor.findLatestByUserId.mockResolvedValue(latest);
      });

      it('prefers the requested space', async () => {
        memberOf('space-1', 'space-2');

        const result = await service.loadActiveMembership(1, 'space-2');

        expect(result?.member).toBe(other);
      });

      it('falls back to lastSpaceId when the requested space is no longer a membership', async () => {
        memberOf('space-1');

        const result = await service.loadActiveMembership(1, 'space-2');

        expect(result?.member).toBe(member);
      });

      it('falls back to the latest membership when lastSpaceId is gone too', async () => {
        memberOf();

        const result = await service.loadActiveMembership(1, 'space-2');

        expect(result?.member).toBe(latest);
      });

      it('uses lastSpaceId when nothing was requested', async () => {
        memberOf('space-1', 'space-2');

        const result = await service.loadActiveMembership(1);

        expect(result?.member).toBe(member);
      });
    });
  });

  describe('issue', () => {
    it('signs both tokens with their own secrets and space claims', async () => {
      const pair = await service.issue(user, member, context);

      expect(pair).toEqual({
        accessToken: 'signed-with-access-secret',
        refreshToken: 'signed-with-refresh-secret',
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: 1,
          email: user.email,
          spaceId: 'space-1',
          profileCompleted: true,
        },
        expect.objectContaining({ secret: 'access-secret' }),
      );
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'refresh', spaceId: 'space-1' }),
        expect.objectContaining({ secret: 'refresh-secret' }),
      );
    });

    it('signs a null space for an account with no membership', async () => {
      await service.issue(user, null, context);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: null }),
        expect.objectContaining({ secret: 'access-secret' }),
      );
      expect(userAccessor.setLastSpaceId).not.toHaveBeenCalled();
    });

    it('persists the space it lands in as lastSpaceId, only when it changed', async () => {
      await service.issue(user, member, context);
      expect(userAccessor.setLastSpaceId).not.toHaveBeenCalled();

      await service.issue(user, { ...member, spaceId: 'space-2' }, context);
      expect(userAccessor.setLastSpaceId).toHaveBeenCalledWith(1, 'space-2');
    });

    /**
     * Two sessions issued in the same second must not sign the same string:
     * identical payloads hash identically and collide on
     * `auth_tokens.token_hash`, which is exactly what a fast refresh does.
     */
    it('gives every refresh token its own jti', async () => {
      await service.issue(user, member, context);
      await service.issue(user, member, context);

      const refreshPayloads = jwtService.sign.mock.calls
        .map(([payload]: [Record<string, unknown>]) => payload)
        .filter((payload) => payload.type === 'refresh');
      expect(refreshPayloads).toHaveLength(2);
      expect(refreshPayloads[0].jti).toEqual(expect.any(String));
      expect(refreshPayloads[0].jti).not.toBe(refreshPayloads[1].jti);
    });

    it('persists the refresh token with the expiry taken off its own exp claim', async () => {
      await service.issue(user, member, context);

      expect(authTokenAccessor.create).toHaveBeenCalledWith({
        userId: 1,
        purpose: 'refresh',
        token: 'signed-with-refresh-secret',
        expiresAt: new Date(NOW_SECONDS * 1000),
        userAgent: 'jest',
        ip: '127.0.0.1',
      });
    });

    it('refuses to store a refresh token with no exp claim', async () => {
      jwtService.decode.mockReturnValue({});

      await expect(service.issue(user, member, context)).rejects.toThrow(
        'exp claim',
      );
      expect(authTokenAccessor.create).not.toHaveBeenCalled();
    });
  });

  describe('rotate', () => {
    function validRefreshPayload() {
      return {
        sub: 1,
        email: user.email,
        spaceId: 'space-1',
        profileCompleted: true,
        type: 'refresh',
      };
    }

    it('rejects a garbage or expired refresh token', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.rotate('garbage', context)).resolves.toMatchObject({
        ok: false,
        code: ErrorCode.UNAUTHORIZED,
      });
      expect(authTokenAccessor.rotateRefresh).not.toHaveBeenCalled();
    });

    it('rejects an access token presented as a refresh token', async () => {
      jwtService.verify.mockReturnValue({
        ...validRefreshPayload(),
        type: undefined,
      });

      await expect(
        service.rotate('access-token', context),
      ).resolves.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    });

    it('rejects a refresh token whose account was deactivated', async () => {
      jwtService.verify.mockReturnValue(validRefreshPayload());
      userAccessor.findById.mockResolvedValue({ ...user, isActive: false });

      await expect(
        service.rotate('refresh-token', context),
      ).resolves.toMatchObject({ code: ErrorCode.UNAUTHORIZED });
      expect(authTokenAccessor.rotateRefresh).not.toHaveBeenCalled();
    });

    it('rotates the stored token and rebuilds the claims from the database', async () => {
      jwtService.verify.mockReturnValue(validRefreshPayload());
      // The profile was completed since the token was signed; refresh is where
      // the client finds out.
      userAccessor.findById.mockResolvedValue({
        ...user,
        profileCompleted: false,
      });
      authTokenAccessor.rotateRefresh.mockResolvedValue({ id: 'token-2' });

      const result = await service.rotate('refresh-token', context);

      expect(result).toEqual({
        ok: true,
        data: {
          accessToken: 'signed-with-access-secret',
          refreshToken: 'signed-with-refresh-secret',
        },
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          spaceId: 'space-1',
          profileCompleted: false,
        }),
        expect.objectContaining({ secret: 'access-secret' }),
      );
      expect(authTokenAccessor.rotateRefresh).toHaveBeenCalledWith(
        'refresh-token',
        expect.objectContaining({
          userId: 1,
          token: 'signed-with-refresh-secret',
          expiresAt: new Date(NOW_SECONDS * 1000),
        }),
      );
    });

    it('keeps the space the refresh token was in', async () => {
      jwtService.verify.mockReturnValue({
        ...validRefreshPayload(),
        spaceId: 'space-2',
      });
      spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue({
        ...member,
        spaceId: 'space-2',
      });
      authTokenAccessor.rotateRefresh.mockResolvedValue({ id: 'token-2' });

      await service.rotate('refresh-token', context);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-2' }),
        expect.objectContaining({ secret: 'access-secret' }),
      );
    });

    it('treats a replayed token as compromise and revokes the whole family', async () => {
      jwtService.verify.mockReturnValue(validRefreshPayload());
      authTokenAccessor.rotateRefresh.mockResolvedValue(null);

      const result = await service.rotate('already-rotated', context);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
      expect(authTokenAccessor.revokeAllByUserAndPurpose).toHaveBeenCalledWith(
        1,
        'refresh',
      );
    });
  });

  describe('revoke', () => {
    it('revokes the stored refresh row for the presented token', async () => {
      await service.revoke('refresh-token');

      expect(authTokenAccessor.revoke).toHaveBeenCalledWith(
        'refresh',
        'refresh-token',
      );
    });
  });

  describe('refreshCookieMaxAgeMs', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('derives the lifetime from the token exp claim', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      jwtService.decode.mockReturnValue({ exp: 1_600 });

      expect(service.refreshCookieMaxAgeMs('token')).toBe(600_000);
    });

    it('returns 0 for a token with no exp claim', () => {
      jwtService.decode.mockReturnValue({});

      expect(service.refreshCookieMaxAgeMs('token')).toBe(0);
    });

    it('never goes negative for an already-expired token', () => {
      jest.spyOn(Date, 'now').mockReturnValue(2_000_000);
      jwtService.decode.mockReturnValue({ exp: 1_000 });

      expect(service.refreshCookieMaxAgeMs('token')).toBe(0);
    });
  });
});
