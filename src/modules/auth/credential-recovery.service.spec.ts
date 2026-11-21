import { SpaceMember, User } from '@prisma/client';
import { CredentialTtl, ErrorCode } from '../../cross/common/constants';
import { CredentialRecoveryService } from './credential-recovery.service';

const TOKEN_PAIR = { accessToken: 'atoken', refreshToken: 'rtoken' };
const CONTEXT = { userAgent: 'jest', ip: '127.0.0.1' };
const NOW = 1_700_000_000_000;

describe('CredentialRecoveryService', () => {
  const user = {
    id: 1,
    email: 'owner@example.com',
    isActive: true,
    profileCompleted: true,
  } as User;
  const member = { spaceId: 'space-1', role: 'admin' } as SpaceMember;

  let userAccessor: { findByEmail: jest.Mock; recordLogin: jest.Mock };
  let authTokenAccessor: {
    create: jest.Mock;
    findUsableByToken: jest.Mock;
    consume: jest.Mock;
    consumePasswordReset: jest.Mock;
  };
  let passwordHash: { hash: jest.Mock };
  let secretToken: { generate: jest.Mock };
  let sessionService: { issue: jest.Mock; loadActiveMembership: jest.Mock };
  let delivery: { deliver: jest.Mock };
  let service: CredentialRecoveryService;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    userAccessor = {
      findByEmail: jest.fn().mockResolvedValue(user),
      recordLogin: jest.fn().mockResolvedValue(user),
    };
    authTokenAccessor = {
      create: jest.fn().mockResolvedValue({ id: 'token-1' }),
      findUsableByToken: jest.fn(),
      consume: jest.fn().mockResolvedValue(true),
      consumePasswordReset: jest.fn(),
    };
    passwordHash = { hash: jest.fn().mockResolvedValue('new-hash') };
    secretToken = { generate: jest.fn().mockReturnValue('raw-token') };
    sessionService = {
      issue: jest.fn().mockResolvedValue(TOKEN_PAIR),
      loadActiveMembership: jest.fn().mockResolvedValue({ user, member }),
    };
    delivery = { deliver: jest.fn().mockResolvedValue(undefined) };
    service = new CredentialRecoveryService(
      userAccessor as never,
      authTokenAccessor as never,
      passwordHash as never,
      secretToken,
      sessionService as never,
      delivery,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * The request routes answer before the issuance runs, so an assertion about
   * what was written or delivered has to wait for the detached work to settle.
   */
  const flushIssuance = () =>
    new Promise((resolve) => {
      setImmediate(resolve);
    });

  describe('requestPasswordReset', () => {
    it('stores only the hash of a freshly generated token and delivers the raw one', async () => {
      const result = await service.requestPasswordReset('Owner@Example.com');

      expect(result).toEqual({ ok: true, data: { accepted: true } });
      await flushIssuance();
      expect(userAccessor.findByEmail).toHaveBeenCalledWith(
        'owner@example.com',
      );
      expect(authTokenAccessor.create).toHaveBeenCalledWith({
        userId: 1,
        purpose: 'password_reset',
        token: 'raw-token',
        expiresAt: new Date(
          NOW + CredentialTtl.PASSWORD_RESET_MINUTES * 60 * 1000,
        ),
      });
      expect(delivery.deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'password_reset',
          token: 'raw-token',
        }),
      );
    });

    it('answers identically for an unknown address and issues nothing', async () => {
      userAccessor.findByEmail.mockResolvedValue(null);

      const result = await service.requestPasswordReset('ghost@example.com');

      expect(result).toEqual({ ok: true, data: { accepted: true } });
      await flushIssuance();
      expect(authTokenAccessor.create).not.toHaveBeenCalled();
      expect(delivery.deliver).not.toHaveBeenCalled();
    });

    it('answers identically for a deactivated account', async () => {
      userAccessor.findByEmail.mockResolvedValue({ ...user, isActive: false });

      const result = await service.requestPasswordReset(user.email);

      expect(result).toEqual({ ok: true, data: { accepted: true } });
      await flushIssuance();
      expect(authTokenAccessor.create).not.toHaveBeenCalled();
    });
  });

  describe('confirmPasswordReset', () => {
    it('hands the accessor the hash, never the plaintext', async () => {
      authTokenAccessor.consumePasswordReset.mockResolvedValue(1);

      const result = await service.confirmPasswordReset(
        'raw-token',
        'a-long-enough-password',
      );

      expect(result).toEqual({ ok: true, data: { accepted: true } });
      expect(authTokenAccessor.consumePasswordReset).toHaveBeenCalledWith(
        'raw-token',
        'new-hash',
      );
    });

    it('rejects a used, expired or unknown token', async () => {
      authTokenAccessor.consumePasswordReset.mockResolvedValue(null);

      const result = await service.confirmPasswordReset(
        'stale',
        'password123456',
      );

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    });
  });

  describe('requestMagicLink', () => {
    it('issues a magic-link token with its own lifetime', async () => {
      await service.requestMagicLink(user.email);
      await flushIssuance();

      expect(authTokenAccessor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'magic_link',
          expiresAt: new Date(
            NOW + CredentialTtl.MAGIC_LINK_MINUTES * 60 * 1000,
          ),
        }),
      );
    });

    /**
     * The point of detaching the issuance. A registered address pays a token
     * write and an SMTP round trip; an unregistered one pays nothing, and no
     * dummy work imitates those cheaply, so the answer is given before any of
     * it runs. A relay that never answers must not hold the response open —
     * which is the same reason the failure is only logged.
     */
    it('answers without waiting for the delivery', async () => {
      delivery.deliver.mockReturnValue(new Promise(() => {}));

      const result = await service.requestMagicLink(user.email);

      expect(result).toEqual({ ok: true, data: { accepted: true } });
    });
  });

  describe('consumeMagicLink', () => {
    it('rejects an unknown or expired link', async () => {
      authTokenAccessor.findUsableByToken.mockResolvedValue(null);

      const result = await service.consumeMagicLink('stale', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
      expect(authTokenAccessor.consume).not.toHaveBeenCalled();
    });

    it('rejects a link whose account was deactivated', async () => {
      authTokenAccessor.findUsableByToken.mockResolvedValue({ userId: 1 });
      sessionService.loadActiveMembership.mockResolvedValue(null);

      const result = await service.consumeMagicLink('raw-token', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
      expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it('burns the link before issuing the session', async () => {
      authTokenAccessor.findUsableByToken.mockResolvedValue({ userId: 1 });
      const order: string[] = [];
      authTokenAccessor.consume.mockImplementation(() => {
        order.push('consume');
        return Promise.resolve(true);
      });
      sessionService.issue.mockImplementation(() => {
        order.push('issue');
        return Promise.resolve(TOKEN_PAIR);
      });

      const result = await service.consumeMagicLink('raw-token', CONTEXT);

      expect(result).toEqual({ ok: true, data: TOKEN_PAIR });
      expect(order).toEqual(['consume', 'issue']);
      expect(userAccessor.recordLogin).toHaveBeenCalledWith(1);
    });

    it('rejects a second use of the same link', async () => {
      authTokenAccessor.findUsableByToken.mockResolvedValue({ userId: 1 });
      authTokenAccessor.consume.mockResolvedValue(false);

      const result = await service.consumeMagicLink('raw-token', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
      expect(sessionService.issue).not.toHaveBeenCalled();
    });
  });
});
