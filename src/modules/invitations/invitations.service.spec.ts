import { SpaceMember, User } from '@prisma/client';
import { CredentialTtl, ErrorCode } from '../../cross/common/constants';
import { InvitationsService } from './invitations.service';

const TOKEN_PAIR = { accessToken: 'atoken', refreshToken: 'rtoken' };
const CONTEXT = { userAgent: 'jest', ip: '127.0.0.1' };
const NOW = 1_700_000_000_000;
const CAMERA_ID = '11111111-1111-4111-8111-111111111111';

describe('InvitationsService', () => {
  const invitation = {
    id: 'invitation-1',
    spaceId: 'space-1',
    email: 'member@example.com',
    invitedByUserId: 1,
    expiresAt: new Date(NOW + 1000),
    acceptedAt: null,
    declinedAt: null,
    revokedAt: null,
    createdUserId: null,
    createdAt: new Date(NOW),
    role: 'guest',
    menuAccess: ['home', 'monitor', 'bogus'],
    cameraIds: [CAMERA_ID, 7],
    space: { name: 'Casa' },
    invitedBy: { firstName: 'Ada', lastName: 'Lovelace' },
  };
  const invitedUser = {
    id: 2,
    email: 'member@example.com',
    isActive: true,
  } as User;
  const member = {
    spaceId: 'space-1',
    userId: 2,
    role: 'guest',
  } as SpaceMember;
  const claims = {
    sub: 2,
    email: 'member@example.com',
    spaceId: null,
    profileCompleted: true,
  };

  let invitationAccessor: Record<string, jest.Mock>;
  let userAccessor: { findByEmail: jest.Mock; findById: jest.Mock };
  let spaceMemberAccessor: { findBySpaceAndUser: jest.Mock };
  let cameraAccessor: { findAll: jest.Mock };
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
      findPendingById: jest.fn().mockResolvedValue(invitation),
      findPendingByToken: jest.fn().mockResolvedValue(invitation),
      findPendingForEmail: jest.fn().mockResolvedValue([invitation]),
      revoke: jest.fn().mockResolvedValue(true),
      decline: jest.fn().mockResolvedValue(true),
      renew: jest.fn().mockResolvedValue(invitation),
      accept: jest.fn().mockResolvedValue(member),
    };
    userAccessor = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(invitedUser),
    };
    spaceMemberAccessor = {
      findBySpaceAndUser: jest.fn().mockResolvedValue(null),
    };
    cameraAccessor = {
      findAll: jest.fn().mockResolvedValue([{ id: CAMERA_ID }]),
    };
    secretToken = { generate: jest.fn().mockReturnValue('raw-token') };
    sessionService = { issue: jest.fn().mockResolvedValue(TOKEN_PAIR) };
    delivery = { deliver: jest.fn().mockResolvedValue(undefined) };
    service = new InvitationsService(
      invitationAccessor as never,
      userAccessor as never,
      spaceMemberAccessor as never,
      cameraAccessor as never,
      secretToken,
      sessionService as never,
      delivery,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('stores role, permissions and the normalized address, and mails the raw token', async () => {
      const result = await service.create('space-1', 1, {
        email: 'Member@Example.com',
        role: 'guest',
        menuAccess: ['home'],
        cameraIds: [CAMERA_ID],
      });

      expect(result).toMatchObject({
        ok: true,
        data: {
          id: 'invitation-1',
          role: 'guest',
          menuAccess: ['home', 'monitor'],
          cameraIds: [CAMERA_ID],
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
        role: 'guest',
        menuAccess: ['home'],
        cameraIds: [CAMERA_ID],
      });
      expect(delivery.deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'invitation',
          token: 'raw-token',
          invitation: {
            spaceName: 'Casa',
            inviterName: 'Ada Lovelace',
            role: 'guest',
          },
        }),
      );
      expect(JSON.stringify(result)).not.toContain('raw-token');
    });

    it('defaults the menu by role and the cameras to none', async () => {
      await service.create('space-1', 1, {
        email: 'member@example.com',
        role: 'collaborator',
      });

      expect(invitationAccessor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          menuAccess: ['home', 'monitor', 'events', 'dvr', 'channels'],
          cameraIds: [],
        }),
      );
      expect(cameraAccessor.findAll).not.toHaveBeenCalled();
    });

    it('does not mind the user belonging to another space', async () => {
      userAccessor.findByEmail.mockResolvedValue(invitedUser);

      const result = await service.create('space-1', 1, {
        email: 'member@example.com',
        role: 'admin',
      });

      expect(result.ok).toBe(true);
      expect(spaceMemberAccessor.findBySpaceAndUser).toHaveBeenCalledWith(
        'space-1',
        2,
      );
    });

    it('rejects somebody who is already a member of this space', async () => {
      userAccessor.findByEmail.mockResolvedValue(invitedUser);
      spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue(member);

      const result = await service.create('space-1', 1, {
        email: 'member@example.com',
        role: 'guest',
      });

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(invitationAccessor.create).not.toHaveBeenCalled();
    });

    it('rejects a second pending invitation in the same space', async () => {
      invitationAccessor.findPendingBySpaceAndEmail.mockResolvedValue(
        invitation,
      );

      const result = await service.create('space-1', 1, {
        email: 'member@example.com',
        role: 'guest',
      });

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(invitationAccessor.create).not.toHaveBeenCalled();
    });

    it('rejects cameras that are not in this space', async () => {
      const result = await service.create('space-1', 1, {
        email: 'member@example.com',
        role: 'guest',
        cameraIds: ['22222222-2222-4222-8222-222222222222'],
      });

      expect(result).toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
      expect(invitationAccessor.create).not.toHaveBeenCalled();
    });
  });

  describe('findPending', () => {
    it('maps the rows and never carries the token hash', async () => {
      invitationAccessor.findPendingBySpace.mockResolvedValue([invitation]);

      const result = await service.findPending('space-1');

      expect(result).toMatchObject({ ok: true, data: { total: 1 } });
      expect(JSON.stringify(result)).not.toContain('tokenHash');
    });
  });

  describe('revoke', () => {
    it('revokes a pending invitation of the space', async () => {
      const result = await service.revoke('space-1', 'invitation-1');

      expect(result).toEqual({ ok: true, data: null });
      expect(invitationAccessor.findPendingById).toHaveBeenCalledWith(
        'invitation-1',
        'space-1',
      );
      expect(invitationAccessor.revoke).toHaveBeenCalledWith('invitation-1');
    });

    it('answers not found when it is not pending in this space', async () => {
      invitationAccessor.findPendingById.mockResolvedValue(null);

      const result = await service.revoke('space-1', 'invitation-1');

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(invitationAccessor.revoke).not.toHaveBeenCalled();
    });
  });

  describe('resend', () => {
    it('issues a fresh token and expiry and mails it again', async () => {
      const result = await service.resend('space-1', 'invitation-1');

      expect(result.ok).toBe(true);
      expect(invitationAccessor.renew).toHaveBeenCalledWith(
        'invitation-1',
        'raw-token',
        new Date(NOW + CredentialTtl.INVITATION_DAYS * 24 * 60 * 60 * 1000),
      );
      expect(delivery.deliver).toHaveBeenCalledTimes(1);
    });

    it('answers not found when it is not pending in this space', async () => {
      invitationAccessor.findPendingById.mockResolvedValue(null);

      const result = await service.resend('space-1', 'invitation-1');

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(delivery.deliver).not.toHaveBeenCalled();
    });
  });

  describe('preview', () => {
    it('describes the invitation and whether the address has an account', async () => {
      userAccessor.findByEmail.mockResolvedValue(invitedUser);

      const result = await service.preview('raw-token');

      expect(result).toEqual({
        ok: true,
        data: {
          id: 'invitation-1',
          spaceName: 'Casa',
          invitedByName: 'Ada Lovelace',
          email: 'member@example.com',
          role: 'guest',
          expiresAt: invitation.expiresAt,
          userExists: true,
        },
      });
    });

    it('answers not found for a token that is not pending', async () => {
      invitationAccessor.findPendingByToken.mockResolvedValue(null);

      const result = await service.preview('stale');

      expect(result).toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe('findMine', () => {
    it('lists the pending invitations of the address', async () => {
      const result = await service.findMine('member@example.com');

      expect(result).toEqual({
        ok: true,
        data: [
          {
            id: 'invitation-1',
            spaceId: 'space-1',
            spaceName: 'Casa',
            invitedByName: 'Ada Lovelace',
            role: 'guest',
            expiresAt: invitation.expiresAt,
          },
        ],
      });
    });
  });

  describe('accept', () => {
    it('creates the membership from the invitation and opens a session in it', async () => {
      const result = await service.accept(claims, 'invitation-1', CONTEXT);

      expect(result).toEqual({ ok: true, data: TOKEN_PAIR });
      expect(invitationAccessor.accept).toHaveBeenCalledWith('invitation-1', {
        spaceId: 'space-1',
        userId: 2,
        role: 'guest',
        // The unknown key and the non-string camera id are dropped.
        menuAccess: ['home', 'monitor'],
        cameraIds: [CAMERA_ID],
        invitedByUserId: 1,
        receiveAlerts: false,
      });
      expect(sessionService.issue).toHaveBeenCalledWith(
        invitedUser,
        member,
        CONTEXT,
      );
    });

    it('falls back to the role menu when the invitation stored none', async () => {
      invitationAccessor.findPendingById.mockResolvedValue({
        ...invitation,
        role: 'collaborator',
        menuAccess: null,
      });

      await service.accept(claims, 'invitation-1', CONTEXT);

      expect(invitationAccessor.accept).toHaveBeenCalledWith(
        'invitation-1',
        expect.objectContaining({
          menuAccess: ['home', 'monitor', 'events', 'dvr', 'channels'],
          receiveAlerts: true,
        }),
      );
    });

    it('answers conflict when the invitation is not pending', async () => {
      invitationAccessor.findPendingById.mockResolvedValue(null);

      const result = await service.accept(claims, 'invitation-1', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(invitationAccessor.accept).not.toHaveBeenCalled();
    });

    it('refuses an invitation addressed to somebody else', async () => {
      userAccessor.findById.mockResolvedValue({
        ...invitedUser,
        email: 'other@example.com',
      });

      const result = await service.accept(claims, 'invitation-1', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(invitationAccessor.accept).not.toHaveBeenCalled();
    });

    it('answers conflict when it lost the race to consume the invitation', async () => {
      invitationAccessor.accept.mockResolvedValue(null);

      const result = await service.accept(claims, 'invitation-1', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(sessionService.issue).not.toHaveBeenCalled();
    });

    it('rejects a deactivated account', async () => {
      userAccessor.findById.mockResolvedValue({
        ...invitedUser,
        isActive: false,
      });

      const result = await service.accept(claims, 'invitation-1', CONTEXT);

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    });
  });

  describe('decline', () => {
    it('marks the invitation declined', async () => {
      const result = await service.decline(claims, 'invitation-1');

      expect(result).toEqual({ ok: true, data: null });
      expect(invitationAccessor.decline).toHaveBeenCalledWith('invitation-1');
    });

    it('refuses an invitation addressed to somebody else', async () => {
      userAccessor.findById.mockResolvedValue({
        ...invitedUser,
        email: 'other@example.com',
      });

      const result = await service.decline(claims, 'invitation-1');

      expect(result).toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(invitationAccessor.decline).not.toHaveBeenCalled();
    });
  });
});
