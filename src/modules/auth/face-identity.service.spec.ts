import { SpaceMember, User } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { FaceIdentityService } from './face-identity.service';

const TOKEN_PAIR = { accessToken: 'atoken', refreshToken: 'rtoken' };
const CONTEXT = { userAgent: 'jest', ip: '127.0.0.1' };

describe('FaceIdentityService', () => {
  const user = { id: 1, email: 'owner@example.com', isActive: true } as User;
  const member = { spaceId: 'space-1', role: 'admin' } as SpaceMember;
  const identity = {
    id: 'identity-1',
    userId: 1,
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
  };

  let faceIdentityAccessor: {
    register: jest.Mock;
    findActiveByToken: jest.Mock;
    recordUse: jest.Mock;
  };
  let userAccessor: { recordLogin: jest.Mock };
  let sessionService: { issue: jest.Mock; loadActiveMembership: jest.Mock };
  let service: FaceIdentityService;

  beforeEach(() => {
    faceIdentityAccessor = {
      register: jest.fn().mockResolvedValue(identity),
      findActiveByToken: jest.fn(),
      recordUse: jest.fn().mockResolvedValue(true),
    };
    userAccessor = { recordLogin: jest.fn().mockResolvedValue(user) };
    sessionService = {
      issue: jest.fn().mockResolvedValue(TOKEN_PAIR),
      loadActiveMembership: jest.fn().mockResolvedValue({ user, member }),
    };
    service = new FaceIdentityService(
      faceIdentityAccessor as never,
      userAccessor as never,
      sessionService as never,
    );
  });

  describe('register', () => {
    it('rejects a caller with no active membership', async () => {
      sessionService.loadActiveMembership.mockResolvedValue(null);

      const result = await service.register(1, 'provider-token');

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
      expect(faceIdentityAccessor.register).not.toHaveBeenCalled();
    });

    it('returns the identity id without echoing the provider token', async () => {
      const result = await service.register(1, 'provider-token');

      expect(result).toEqual({
        ok: true,
        data: { id: 'identity-1', createdAt: identity.createdAt },
      });
      expect(JSON.stringify(result)).not.toContain('provider-token');
    });
  });

  describe('login', () => {
    it('rejects an unrecognized identity', async () => {
      faceIdentityAccessor.findActiveByToken.mockResolvedValue(null);

      const result = await service.login('unknown-token', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
      expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it('rejects a revoked identity with the same message as an unknown one', async () => {
      // Revoked rows are excluded by the accessor, so both look identical here.
      faceIdentityAccessor.findActiveByToken.mockResolvedValue(null);

      const result = await service.login('revoked-token', CONTEXT);

      expect(result).toEqual({
        ok: false,
        code: ErrorCode.UNAUTHORIZED,
        message: 'Face identity is not recognized',
      });
    });

    it('rejects an identity whose account was deactivated', async () => {
      faceIdentityAccessor.findActiveByToken.mockResolvedValue(identity);
      sessionService.loadActiveMembership.mockResolvedValue(null);

      const result = await service.login('provider-token', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    });

    it('records the use and issues a session', async () => {
      faceIdentityAccessor.findActiveByToken.mockResolvedValue(identity);

      const result = await service.login('provider-token', CONTEXT);

      expect(result).toEqual({ ok: true, data: TOKEN_PAIR });
      expect(faceIdentityAccessor.recordUse).toHaveBeenCalledWith(
        'provider-token',
      );
      expect(userAccessor.recordLogin).toHaveBeenCalledWith(1);
      expect(sessionService.issue).toHaveBeenCalledWith(user, member, CONTEXT);
    });
  });
});
