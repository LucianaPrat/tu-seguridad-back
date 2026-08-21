import { SpaceMember, User } from '@prisma/client';
import { CredentialTtl, ErrorCode } from '../../cross/common/constants';
import { InvitationsService } from './invitations.service';

const TOKEN_PAIR = { accessToken: 'atoken', refreshToken: 'rtoken' };
const CONTEXT = { userAgent: 'jest', ip: '127.0.0.1' };
const NOW = 1_700_000_000_000;

describe('InvitationsService', () => {
  const invitation = {
    id: 'invitation-1',
    spaceId: 'space-1',
    email: 'member@example.com',
    invitedByUserId: 1,
    expiresAt: new Date(NOW + 1000),
    acceptedAt: null,
    createdUserId: null,
    createdAt: new Date(NOW),
  };
  const invitedUser = {
    id: 2,
    email: 'member@example.com',
    isActive: true,
    profileCompleted: false,
  } as User;
  const member = {
    spaceId: 'space-1',
    userId: 2,
    role: 'member',
  } as SpaceMember;

  let invitationAccessor: {
    create: jest.Mock;
    findPendingBySpaceAndEmail: jest.Mock;
    findPendingBySpace: jest.Mock;
    findUsableByToken: jest.Mock;
    acceptWithNewUser: jest.Mock;
    acceptWithExistingUser: jest.Mock;
  };
  let userAccessor: { findByEmail: jest.Mock; findById: jest.Mock };
  let spaceMemberAccessor: { findByUserId: jest.Mock };
  let passwordHash: { hash: jest.Mock };
  let secretToken: { generate: jest.Mock };
  let sessionService: { issue: jest.Mock };
  let delivery: { deliver: jest.Mock };
  let service: InvitationsService;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    invitationAccessor = {
      create: jest.fn().mockResolvedValue(invitation),
      findPendingBySpaceAndEmail: jest.fn().mockResolvedValue(null),
      findPendingBySpace: jest.fn().mockResolvedValue([]),
      findUsableByToken: jest.fn().mockResolvedValue(invitation),
      acceptWithNewUser: jest
        .fn()
        .mockResolvedValue({ invitation, member, user: invitedUser }),
      acceptWithExistingUser: jest.fn().mockResolvedValue({
        invitation,
        member,
      }),
    };
    userAccessor = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(invitedUser),
    };
    spaceMemberAccessor = { findByUserId: jest.fn().mockResolvedValue(null) };
    passwordHash = { hash: jest.fn().mockResolvedValue('placeholder-hash') };
    secretToken = { generate: jest.fn().mockReturnValue('raw-token') };
    sessionService = { issue: jest.fn().mockResolvedValue(TOKEN_PAIR) };
    delivery = { deliver: jest.fn().mockResolvedValue(undefined) };
    service = new InvitationsService(
      invitationAccessor as never,
      userAccessor as never,
      spaceMemberAccessor as never,
      passwordHash as never,
      secretToken,
      sessionService as never,
      delivery,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('stores the normalized address and delivers the raw token out of band', async () => {
      const result = await service.create('space-1', 1, 'Member@Example.com');

      expect(result).toEqual({
        ok: true,
        data: {
          id: 'invitation-1',
          email: 'member@example.com',
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        },
      });
      expect(invitationAccessor.create).toHaveBeenCalledWith({
        spaceId: 'space-1',
        email: 'member@example.com',
        token: 'raw-token',
        invitedByUserId: 1,
        expiresAt: new Date(
          NOW + CredentialTtl.INVITATION_DAYS * 24 * 60 * 60 * 1000,
        ),
      });
      expect(delivery.deliver).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'invitation', token: 'raw-token' }),
      );
    });

    it('never returns the raw token to the inviting administrator', async () => {
      const result = await service.create('space-1', 1, 'member@example.com');

      expect(JSON.stringify(result)).not.toContain('raw-token');
    });

    it('rejects inviting somebody who already belongs to a space', async () => {
      userAccessor.findByEmail.mockResolvedValue(invitedUser);
      spaceMemberAccessor.findByUserId.mockResolvedValue(member);

      const result = await service.create('space-1', 1, 'member@example.com');

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(invitationAccessor.create).not.toHaveBeenCalled();
    });

    it('rejects a second pending invitation for the same address', async () => {
      invitationAccessor.findPendingBySpaceAndEmail.mockResolvedValue(
        invitation,
      );

      const result = await service.create('space-1', 1, 'member@example.com');

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(invitationAccessor.create).not.toHaveBeenCalled();
    });
  });

  describe('findPending', () => {
    const second = {
      ...invitation,
      id: 'invitation-2',
      email: 'other@example.com',
    };

    it('maps the accessor rows to DTOs in order', async () => {
      invitationAccessor.findPendingBySpace.mockResolvedValue([
        invitation,
        second,
      ]);

      const result = await service.findPending('space-1');

      expect(result).toEqual({
        ok: true,
        data: {
          items: [
            {
              id: invitation.id,
              email: invitation.email,
              expiresAt: invitation.expiresAt,
              createdAt: invitation.createdAt,
            },
            {
              id: second.id,
              email: second.email,
              expiresAt: second.expiresAt,
              createdAt: second.createdAt,
            },
          ],
          total: 2,
        },
      });
    });

    it('returns an empty list for a space with no pending invitations', async () => {
      invitationAccessor.findPendingBySpace.mockResolvedValue([]);

      const result = await service.findPending('space-1');

      expect(result).toEqual({ ok: true, data: { items: [], total: 0 } });
    });

    it('never carries the token hash', async () => {
      invitationAccessor.findPendingBySpace.mockResolvedValue([invitation]);

      const result = await service.findPending('space-1');

      expect(JSON.stringify(result)).not.toContain('tokenHash');
    });
  });

  describe('accept', () => {
    it('rejects an unknown or expired token', async () => {
      invitationAccessor.findUsableByToken.mockResolvedValue(null);

      const result = await service.accept('stale', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
      expect(invitationAccessor.acceptWithNewUser).not.toHaveBeenCalled();
    });

    it('creates the account with an unusable placeholder password', async () => {
      const result = await service.accept('raw-token', CONTEXT);

      expect(result).toEqual({ ok: true, data: TOKEN_PAIR });
      expect(passwordHash.hash).toHaveBeenCalledWith('raw-token');
      expect(invitationAccessor.acceptWithNewUser).toHaveBeenCalledWith({
        token: 'raw-token',
        email: 'member@example.com',
        passwordHash: 'placeholder-hash',
      });
      // The session is issued off a `profileCompleted: false` user, so the
      // global gate keeps it on profile completion.
      expect(sessionService.issue).toHaveBeenCalledWith(
        invitedUser,
        member,
        CONTEXT,
      );
    });

    it('rejects a second click on the same link', async () => {
      invitationAccessor.acceptWithNewUser.mockResolvedValue(null);

      const result = await service.accept('raw-token', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
      expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it('links an existing account that has no membership yet', async () => {
      const existing = { ...invitedUser, profileCompleted: true };
      userAccessor.findByEmail.mockResolvedValue(existing);
      userAccessor.findById.mockResolvedValue(existing);

      const result = await service.accept('raw-token', CONTEXT);

      expect(result).toEqual({ ok: true, data: TOKEN_PAIR });
      expect(invitationAccessor.acceptWithExistingUser).toHaveBeenCalledWith(
        'raw-token',
        2,
      );
      expect(invitationAccessor.acceptWithNewUser).not.toHaveBeenCalled();
    });

    it('refuses to give an existing member a second space', async () => {
      userAccessor.findByEmail.mockResolvedValue(invitedUser);
      spaceMemberAccessor.findByUserId.mockResolvedValue(member);

      const result = await service.accept('raw-token', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(invitationAccessor.acceptWithExistingUser).not.toHaveBeenCalled();
    });

    it('rejects acceptance by a deactivated account', async () => {
      userAccessor.findByEmail.mockResolvedValue(invitedUser);
      userAccessor.findById.mockResolvedValue({
        ...invitedUser,
        isActive: false,
      });

      const result = await service.accept('raw-token', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    });
  });
});
