import { Prisma, Space, SpaceMember, User } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { AuthService } from './auth.service';

const TOKEN_PAIR = { accessToken: 'atoken', refreshToken: 'rtoken' };

describe('AuthService', () => {
  const user = {
    id: 1,
    email: 'owner@example.com',
    passwordHash: 'hashed',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+5491122334455',
    avatarUrl: null,
    isActive: true,
    profileCompleted: true,
  } as User;
  const member = {
    id: 'member-1',
    spaceId: 'space-1',
    userId: 1,
    role: 'admin',
    receiveAlerts: true,
  } as SpaceMember;
  const space = { id: 'space-1', name: 'My Secure Space' } as Space;
  const context = { userAgent: 'jest', ip: '127.0.0.1' };

  let userAccessor: {
    findByEmail: jest.Mock;
    findById: jest.Mock;
    recordLogin: jest.Mock;
    completeProfile: jest.Mock;
  };
  let spaceAccessor: { createWithOwner: jest.Mock; findById: jest.Mock };
  let spaceMemberAccessor: { findByUserId: jest.Mock };
  let passwordHash: { hash: jest.Mock; verify: jest.Mock };
  let sessionService: { issue: jest.Mock; loadActiveMembership: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    userAccessor = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      recordLogin: jest.fn().mockResolvedValue(user),
      completeProfile: jest.fn(),
    };
    spaceAccessor = {
      createWithOwner: jest.fn(),
      findById: jest.fn().mockResolvedValue(space),
    };
    spaceMemberAccessor = { findByUserId: jest.fn().mockResolvedValue(member) };
    passwordHash = {
      hash: jest.fn().mockResolvedValue('new-hash'),
      verify: jest.fn().mockResolvedValue(true),
      verifyAgainstDummy: jest.fn().mockResolvedValue(undefined),
    };
    sessionService = {
      issue: jest.fn().mockResolvedValue(TOKEN_PAIR),
      loadActiveMembership: jest.fn().mockResolvedValue({ user, member }),
    };
    service = new AuthService(
      userAccessor as never,
      spaceAccessor as never,
      spaceMemberAccessor as never,
      passwordHash,
      sessionService as never,
    );
  });

  describe('login', () => {
    it('returns UNAUTHORIZED when the user does not exist', async () => {
      userAccessor.findByEmail.mockResolvedValue(null);

      const result = await service.login('missing@example.com', 'pw', context);

      expect(result).toEqual({
        ok: false,
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid email or password',
      });
      // The branch that found nothing still pays a bcrypt compare, so the
      // answer takes as long as one for an address that exists.
      expect(passwordHash.verifyAgainstDummy).toHaveBeenCalledWith('pw');
    });

    it('looks the account up by its normalized email', async () => {
      userAccessor.findByEmail.mockResolvedValue(null);

      await service.login('  Owner@Example.COM ', 'pw', context);

      expect(userAccessor.findByEmail).toHaveBeenCalledWith(
        'owner@example.com',
      );
    });

    it('returns UNAUTHORIZED on wrong password', async () => {
      userAccessor.findByEmail.mockResolvedValue(user);
      passwordHash.verify.mockResolvedValue(false);

      const result = await service.login(user.email, 'wrong', context);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
      expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it('rejects a deactivated account with the same message as a wrong password', async () => {
      userAccessor.findByEmail.mockResolvedValue({ ...user, isActive: false });

      const result = await service.login(user.email, 'correct', context);

      expect(result).toEqual({
        ok: false,
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid email or password',
      });
    });

    it('rejects an account with no accepted membership', async () => {
      userAccessor.findByEmail.mockResolvedValue(user);
      spaceMemberAccessor.findByUserId.mockResolvedValue(null);

      const result = await service.login(user.email, 'correct', context);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
      expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it('issues a session and stamps the login on success', async () => {
      userAccessor.findByEmail.mockResolvedValue(user);

      const result = await service.login(user.email, 'correct', context);

      expect(result).toEqual({ ok: true, data: TOKEN_PAIR });
      expect(userAccessor.recordLogin).toHaveBeenCalledWith(1);
      expect(sessionService.issue).toHaveBeenCalledWith(user, member, context);
    });
  });

  describe('register', () => {
    const dto = {
      email: 'New@Example.com',
      password: 'a-long-enough-password',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '+5491122334455',
      spaceName: 'My Secure Space',
    };

    it('rejects an email that is already registered', async () => {
      userAccessor.findByEmail.mockResolvedValue(user);

      const result = await service.register(dto, context);

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(spaceAccessor.createWithOwner).not.toHaveBeenCalled();
    });

    it('creates the owner, its space and its membership in one call', async () => {
      userAccessor.findByEmail.mockResolvedValue(null);
      spaceAccessor.createWithOwner.mockResolvedValue({ user, space, member });

      const result = await service.register(dto, context);

      expect(result).toEqual({ ok: true, data: TOKEN_PAIR });
      expect(spaceAccessor.createWithOwner).toHaveBeenCalledWith({
        user: expect.objectContaining({
          email: 'new@example.com',
          passwordHash: 'new-hash',
          profileCompleted: true,
        }) as Record<string, unknown>,
        spaceName: 'My Secure Space',
      });
      expect(sessionService.issue).toHaveBeenCalledWith(user, member, context);
    });

    it('never stores the plaintext password', async () => {
      userAccessor.findByEmail.mockResolvedValue(null);
      spaceAccessor.createWithOwner.mockResolvedValue({ user, space, member });

      await service.register(dto, context);

      const [{ user: created }] = spaceAccessor.createWithOwner.mock
        .calls[0] as [{ user: Record<string, unknown> }];
      expect(Object.values(created)).not.toContain(dto.password);
    });

    it('maps the unique-email race onto CONFLICT rather than leaking a driver code', async () => {
      userAccessor.findByEmail.mockResolvedValue(null);
      spaceAccessor.createWithOwner.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.register(dto, context);

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
    });

    it('rethrows an unrelated database failure', async () => {
      userAccessor.findByEmail.mockResolvedValue(null);
      spaceAccessor.createWithOwner.mockRejectedValue(new Error('boom'));

      await expect(service.register(dto, context)).rejects.toThrow('boom');
    });
  });

  describe('completeProfile', () => {
    const dto = {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '+5491122334455',
      password: 'a-long-enough-password',
    };
    const invited = { ...user, profileCompleted: false } as User;

    it('rejects a caller with no active membership', async () => {
      sessionService.loadActiveMembership.mockResolvedValue(null);

      const result = await service.completeProfile(1, dto, context);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    });

    it('rejects a profile that is already completed', async () => {
      const result = await service.completeProfile(1, dto, context);

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(userAccessor.completeProfile).not.toHaveBeenCalled();
    });

    it('stores the hashed password and issues a fresh pair', async () => {
      sessionService.loadActiveMembership.mockResolvedValue({
        user: invited,
        member,
      });
      const completed = { ...invited, profileCompleted: true };
      userAccessor.completeProfile.mockResolvedValue(completed);

      const result = await service.completeProfile(1, dto, context);

      expect(result).toEqual({ ok: true, data: TOKEN_PAIR });
      expect(userAccessor.completeProfile).toHaveBeenCalledWith(1, {
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '+5491122334455',
        avatarUrl: undefined,
        passwordHash: 'new-hash',
      });
      // The new claim only reaches the client through a newly signed token.
      expect(sessionService.issue).toHaveBeenCalledWith(
        completed,
        member,
        context,
      );
    });
  });

  describe('me', () => {
    it('returns the profile with its space context', async () => {
      const result = await service.me(1);

      expect(result).toEqual({
        ok: true,
        data: {
          id: 1,
          email: 'owner@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          phone: '+5491122334455',
          avatarUrl: null,
          isActive: true,
          profileCompleted: true,
          spaceId: 'space-1',
          spaceName: 'My Secure Space',
          role: 'admin',
          receiveAlerts: true,
        },
      });
    });

    it('never returns the password hash', async () => {
      const result = await service.me(1);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.keys(result.data)).not.toContain('passwordHash');
      }
    });

    it('returns UNAUTHORIZED for a deactivated or membership-less account', async () => {
      sessionService.loadActiveMembership.mockResolvedValue(null);

      const result = await service.me(1);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    });
  });
});
