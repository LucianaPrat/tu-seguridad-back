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
  let userAccessor: { findById: jest.Mock };
  let spaceMemberAccessor: { findByUserId: jest.Mock };
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
    userAccessor = { findById: jest.fn().mockResolvedValue(user) };
    spaceMemberAccessor = {
      findByUserId: jest.fn().mockResolvedValue(member),
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
      expect(spaceMemberAccessor.findByUserId).not.toHaveBeenCalled();
    });

    it('rejects an account with no accepted membership', async () => {
      spaceMemberAccessor.findByUserId.mockResolvedValue(null);

      await expect(service.loadActiveMembership(1)).resolves.toBeNull();
    });

    it('returns the user with its membership', async () => {
      await expect(service.loadActiveMembership(1)).resolves.toEqual({
        user,
        member,
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
          role: 'admin',
          profileCompleted: true,
        },
        expect.objectContaining({ secret: 'access-secret' }),
      );
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'refresh', spaceId: 'space-1' }),
        expect.objectContaining({ secret: 'refresh-secret' }),
      );
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
        role: 'admin',
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
      // Claims that went stale since the token was signed: the member was
      // promoted, and refresh is where the client finds out.
      spaceMemberAccessor.findByUserId.mockResolvedValue({
        ...member,
        role: 'member',
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
        expect.objectContaining({ role: 'member' }),
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
