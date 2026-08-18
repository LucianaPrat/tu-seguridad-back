import { CredentialHashService } from '../../cross/crypto/credential-hash.service';
import { PrismaService } from '../prisma/prisma.service';
import { truncateAll } from '../../../test/utils/truncate-all';
import { AuthTokenAccessorService } from './auth-token.accessor';
import { InvitationAccessorService } from './invitation.accessor';
import { SpaceAccessorService } from './space.accessor';
import { SpaceMemberAccessorService } from './space-member.accessor';
import { UserAccessorService } from './user.accessor';

const HOUR_MS = 60 * 60 * 1000;

describe('auth and membership accessors (int)', () => {
  const prisma = new PrismaService({
    datasourceUrl: process.env.DATABASE_URL_TEST,
  });
  const credentialHash = new CredentialHashService();
  const spaceAccessor = new SpaceAccessorService(prisma);
  const spaceMemberAccessor = new SpaceMemberAccessorService(prisma);
  const userAccessor = new UserAccessorService(prisma);
  const invitationAccessor = new InvitationAccessorService(
    prisma,
    credentialHash,
  );
  const authTokenAccessor = new AuthTokenAccessorService(
    prisma,
    credentialHash,
  );

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  function ownerInput(email: string) {
    return {
      user: {
        email,
        passwordHash: 'bcrypt-hash',
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '+5491122334455',
        profileCompleted: true,
      },
      spaceName: 'My Secure Space',
    };
  }

  describe('createWithOwner', () => {
    it('provisions the account, its space, its admin membership and the routing defaults', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );

      expect(owned.space.ownerUserId).toBe(owned.user.id);
      expect(owned.member.role).toBe('admin');
      await expect(
        prisma.alertRouting.count({ where: { spaceId: owned.space.id } }),
      ).resolves.toBe(6);
      await expect(
        prisma.alertRouting.count({
          where: { spaceId: owned.space.id, enabled: true },
        }),
      ).resolves.toBe(2);
    });

    it('leaves nothing behind when the transaction fails', async () => {
      await spaceAccessor.createWithOwner(ownerInput('owner@example.com'));

      await expect(
        spaceAccessor.createWithOwner(ownerInput('owner@example.com')),
      ).rejects.toThrow();

      // The duplicate email aborts on the first statement, so no orphan space or
      // membership survives the failed attempt.
      await expect(prisma.user.count()).resolves.toBe(1);
      await expect(prisma.space.count()).resolves.toBe(1);
      await expect(prisma.spaceMember.count()).resolves.toBe(1);
    });
  });

  describe('one space per user', () => {
    it('is enforced by the database, not only by the service', async () => {
      const first = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      const second = await spaceAccessor.createWithOwner(
        ownerInput('other@example.com'),
      );

      await expect(
        spaceMemberAccessor.create({
          spaceId: second.space.id,
          userId: first.user.id,
          role: 'member',
        }),
      ).rejects.toThrow();
    });
  });

  describe('invitation acceptance', () => {
    async function inviteInto(spaceId: string, invitedByUserId: number) {
      return invitationAccessor.create({
        spaceId,
        email: 'Member@Example.com',
        token: 'raw-invitation-token',
        invitedByUserId,
        expiresAt: new Date(Date.now() + HOUR_MS),
      });
    }

    it('creates the user, its membership and consumes the invitation in one write', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      const invitation = await inviteInto(owned.space.id, owned.user.id);

      const accepted = await invitationAccessor.acceptWithNewUser({
        token: 'raw-invitation-token',
        email: 'member@example.com',
        passwordHash: 'placeholder-hash',
      });

      expect(accepted).not.toBeNull();
      expect(accepted?.member.spaceId).toBe(owned.space.id);
      expect(accepted?.member.role).toBe('member');
      expect(accepted?.member.invitedByUserId).toBe(owned.user.id);
      // Created without a name or phone of its own: `profileCompleted` is what
      // keeps that account off every other route.
      expect(accepted?.user.profileCompleted).toBe(false);
      const stored = await prisma.invitation.findUniqueOrThrow({
        where: { id: invitation.id },
      });
      expect(stored.acceptedAt).not.toBeNull();
      expect(stored.createdUserId).toBe(accepted?.user.id);
    });

    it('rejects a second acceptance of the same token', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      await inviteInto(owned.space.id, owned.user.id);
      await invitationAccessor.acceptWithNewUser({
        token: 'raw-invitation-token',
        email: 'member@example.com',
        passwordHash: 'placeholder-hash',
      });

      const replay = await invitationAccessor.acceptWithNewUser({
        token: 'raw-invitation-token',
        email: 'member@example.com',
        passwordHash: 'placeholder-hash',
      });

      expect(replay).toBeNull();
      await expect(prisma.user.count()).resolves.toBe(2);
      await expect(prisma.spaceMember.count()).resolves.toBe(2);
    });

    it('rejects an expired invitation', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      await invitationAccessor.create({
        spaceId: owned.space.id,
        email: 'late@example.com',
        token: 'expired-token',
        invitedByUserId: owned.user.id,
        expiresAt: new Date(Date.now() - HOUR_MS),
      });

      await expect(
        invitationAccessor.findUsableByToken('expired-token'),
      ).resolves.toBeNull();
      await expect(
        invitationAccessor.acceptWithNewUser({
          token: 'expired-token',
          email: 'late@example.com',
          passwordHash: 'placeholder-hash',
        }),
      ).resolves.toBeNull();
      await expect(prisma.user.count()).resolves.toBe(1);
    });

    it('links an existing account instead of creating a second one', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      const existing = await userAccessor.create({
        email: 'member@example.com',
        passwordHash: 'bcrypt-hash',
        firstName: 'Grace',
        lastName: 'Hopper',
        phone: '+5491199887766',
        profileCompleted: true,
      });
      await inviteInto(owned.space.id, owned.user.id);

      const accepted = await invitationAccessor.acceptWithExistingUser(
        'raw-invitation-token',
        existing.id,
      );

      expect(accepted?.member.userId).toBe(existing.id);
      await expect(prisma.user.count()).resolves.toBe(2);
    });

    it('never returns the token hash it stored', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      const invitation = await inviteInto(owned.space.id, owned.user.id);
      const pending = await invitationAccessor.findPendingBySpaceAndEmail(
        owned.space.id,
        'member@example.com',
      );

      expect(Object.keys(invitation)).not.toContain('tokenHash');
      expect(pending).not.toBeNull();
      expect(Object.keys(pending!)).not.toContain('tokenHash');
    });
  });

  describe('refresh rotation', () => {
    async function issueRefresh(userId: number, token: string) {
      return authTokenAccessor.create({
        userId,
        purpose: 'refresh',
        token,
        expiresAt: new Date(Date.now() + HOUR_MS),
      });
    }

    it('revokes the presented token and records the successor as rotated from it', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      const original = await issueRefresh(owned.user.id, 'refresh-1');

      const rotated = await authTokenAccessor.rotateRefresh('refresh-1', {
        userId: owned.user.id,
        token: 'refresh-2',
        expiresAt: new Date(Date.now() + HOUR_MS),
      });

      expect(rotated?.rotatedFromId).toBe(original.id);
      const stored = await prisma.authToken.findUniqueOrThrow({
        where: { id: original.id },
      });
      expect(stored.revokedAt).not.toBeNull();
      await expect(
        authTokenAccessor.findUsableByToken('refresh', 'refresh-2'),
      ).resolves.not.toBeNull();
    });

    it('refuses to rotate a token that was already rotated', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      await issueRefresh(owned.user.id, 'refresh-1');
      await authTokenAccessor.rotateRefresh('refresh-1', {
        userId: owned.user.id,
        token: 'refresh-2',
        expiresAt: new Date(Date.now() + HOUR_MS),
      });

      const replay = await authTokenAccessor.rotateRefresh('refresh-1', {
        userId: owned.user.id,
        token: 'refresh-3',
        expiresAt: new Date(Date.now() + HOUR_MS),
      });

      expect(replay).toBeNull();
      await expect(
        authTokenAccessor.findUsableByToken('refresh', 'refresh-3'),
      ).resolves.toBeNull();
    });

    it('revokes every refresh token an account holds', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      await issueRefresh(owned.user.id, 'refresh-1');
      await issueRefresh(owned.user.id, 'refresh-2');

      await expect(
        authTokenAccessor.revokeAllByUserAndPurpose(owned.user.id, 'refresh'),
      ).resolves.toBe(2);
      await expect(
        authTokenAccessor.findUsableByToken('refresh', 'refresh-1'),
      ).resolves.toBeNull();
      await expect(
        authTokenAccessor.findUsableByToken('refresh', 'refresh-2'),
      ).resolves.toBeNull();
    });
  });

  describe('consumePasswordReset', () => {
    it('burns the token, stores the new hash and ends every session', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      await authTokenAccessor.create({
        userId: owned.user.id,
        purpose: 'refresh',
        token: 'refresh-1',
        expiresAt: new Date(Date.now() + HOUR_MS),
      });
      await authTokenAccessor.create({
        userId: owned.user.id,
        purpose: 'password_reset',
        token: 'reset-1',
        expiresAt: new Date(Date.now() + HOUR_MS),
      });

      const userId = await authTokenAccessor.consumePasswordReset(
        'reset-1',
        'new-bcrypt-hash',
      );

      expect(userId).toBe(owned.user.id);
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: owned.user.id },
      });
      expect(stored.passwordHash).toBe('new-bcrypt-hash');
      await expect(
        authTokenAccessor.findUsableByToken('refresh', 'refresh-1'),
      ).resolves.toBeNull();
    });

    it('rejects a second use and leaves the stored hash alone', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      await authTokenAccessor.create({
        userId: owned.user.id,
        purpose: 'password_reset',
        token: 'reset-1',
        expiresAt: new Date(Date.now() + HOUR_MS),
      });
      await authTokenAccessor.consumePasswordReset('reset-1', 'first-hash');

      await expect(
        authTokenAccessor.consumePasswordReset('reset-1', 'second-hash'),
      ).resolves.toBeNull();
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: owned.user.id },
      });
      expect(stored.passwordHash).toBe('first-hash');
    });

    it('rejects an expired reset token', async () => {
      const owned = await spaceAccessor.createWithOwner(
        ownerInput('owner@example.com'),
      );
      await authTokenAccessor.create({
        userId: owned.user.id,
        purpose: 'password_reset',
        token: 'stale-reset',
        expiresAt: new Date(Date.now() - HOUR_MS),
      });

      await expect(
        authTokenAccessor.consumePasswordReset('stale-reset', 'new-hash'),
      ).resolves.toBeNull();
    });
  });
});
