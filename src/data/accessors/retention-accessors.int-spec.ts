import { CredentialHashService } from '../../cross/crypto/credential-hash.service';
import { PrismaService } from '../prisma/prisma.service';
import { truncateAll } from '../../../test/utils/truncate-all';
import { AuthTokenAccessorService } from './auth-token.accessor';
import { InvitationAccessorService } from './invitation.accessor';
import { SnapshotAccessorService } from './snapshot.accessor';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-01T00:00:00.000Z');
const CUTOFF = new Date(NOW.getTime() - 30 * DAY_MS);
const WELL_BEFORE = new Date(CUTOFF.getTime() - DAY_MS);
const WELL_AFTER = new Date(CUTOFF.getTime() + DAY_MS);

/**
 * The retention sweeps, against a real database. What they delete is the only
 * irreversible thing this process does, so the boundary cases are asserted on
 * rows either side of the cutoff rather than on a mocked `where`.
 */
describe('retention sweeps (int)', () => {
  const prisma = new PrismaService({
    datasourceUrl: process.env.DATABASE_URL_TEST,
  });
  const credentialHash = new CredentialHashService();
  const authTokenAccessor = new AuthTokenAccessorService(
    prisma,
    credentialHash,
  );
  const invitationAccessor = new InvitationAccessorService(
    prisma,
    credentialHash,
  );
  const snapshotAccessor = new SnapshotAccessorService(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  async function seedUser(email = 'owner@example.com') {
    return prisma.user.create({
      data: {
        email,
        passwordHash: 'bcrypt-hash',
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '+5491122334455',
        profileCompleted: true,
      },
    });
  }

  async function seedSpace(ownerUserId: number) {
    return prisma.space.create({
      data: { name: 'My Secure Space', ownerUserId },
    });
  }

  async function seedCamera(spaceId: string) {
    const dvr = await prisma.dvr.create({
      data: {
        spaceId,
        url: 'http://dvr.local',
        username: 'admin',
        passwordEncrypted: 'ciphertext',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    return prisma.camera.create({
      data: { dvrId: dvr.id, externalId: '101', name: 'Front door' },
    });
  }

  async function seedSnapshot(
    cameraId: string,
    capturedAt: Date,
    isLive = false,
  ) {
    return prisma.snapshot.create({
      data: {
        cameraId,
        data: Buffer.from('frame'),
        mimeType: 'image/jpeg',
        byteSize: 5,
        sha256: `sha-${capturedAt.toISOString()}-${String(isLive)}`,
        capturedAt,
        isLive,
      },
    });
  }

  describe('auth tokens', () => {
    async function seedToken(
      tokenHash: string,
      fields: { expiresAt: Date; usedAt?: Date; revokedAt?: Date },
      userId: number,
    ) {
      return prisma.authToken.create({
        data: { userId, purpose: 'refresh', tokenHash, ...fields },
      });
    }

    it('removes tokens dead before the cutoff and keeps the rest', async () => {
      const user = await seedUser();
      const stale = await seedToken('h1', { expiresAt: WELL_BEFORE }, user.id);
      const spent = await seedToken(
        'h2',
        { expiresAt: WELL_AFTER, usedAt: WELL_BEFORE },
        user.id,
      );
      const revoked = await seedToken(
        'h3',
        { expiresAt: WELL_AFTER, revokedAt: WELL_BEFORE },
        user.id,
      );
      const recentlyExpired = await seedToken(
        'h4',
        { expiresAt: WELL_AFTER },
        user.id,
      );

      const removed = await authTokenAccessor.deleteSpentBefore(CUTOFF, 100);

      expect(removed).toBe(3);
      const left = await prisma.authToken.findMany({ select: { id: true } });
      expect(left.map((row) => row.id)).toEqual([recentlyExpired.id]);
      expect([stale.id, spent.id, revoked.id]).toHaveLength(3);
    });

    it('never removes more than the batch cap in one run', async () => {
      const user = await seedUser();
      for (let i = 0; i < 5; i += 1) {
        await seedToken(`batch-${i}`, { expiresAt: WELL_BEFORE }, user.id);
      }

      expect(await authTokenAccessor.deleteSpentBefore(CUTOFF, 2)).toBe(2);
      expect(await prisma.authToken.count()).toBe(3);
    });

    it('answers zero when there is nothing to remove', async () => {
      expect(await authTokenAccessor.deleteSpentBefore(CUTOFF, 100)).toBe(0);
    });
  });

  describe('invitations', () => {
    it('removes expired and accepted invitations, keeps the live one', async () => {
      const user = await seedUser();
      const space = await seedSpace(user.id);
      const base = {
        spaceId: space.id,
        email: 'invitee@example.com',
        invitedByUserId: user.id,
      };
      await prisma.invitation.create({
        data: { ...base, tokenHash: 'i1', expiresAt: WELL_BEFORE },
      });
      await prisma.invitation.create({
        data: {
          ...base,
          tokenHash: 'i2',
          expiresAt: WELL_AFTER,
          acceptedAt: WELL_BEFORE,
        },
      });
      const live = await prisma.invitation.create({
        data: { ...base, tokenHash: 'i3', expiresAt: WELL_AFTER },
      });

      const removed = await invitationAccessor.deleteSettledBefore(CUTOFF, 100);

      expect(removed).toBe(2);
      const left = await prisma.invitation.findMany({ select: { id: true } });
      expect(left.map((row) => row.id)).toEqual([live.id]);
    });
  });

  describe('snapshots', () => {
    it('removes evidence frames past the cutoff and never the live one', async () => {
      const user = await seedUser();
      const space = await seedSpace(user.id);
      const camera = await seedCamera(space.id);
      const old = await seedSnapshot(camera.id, WELL_BEFORE);
      const recent = await seedSnapshot(camera.id, WELL_AFTER);
      const live = await seedSnapshot(camera.id, WELL_BEFORE, true);

      const removed = await snapshotAccessor.deleteEvidenceBefore(CUTOFF, 100);

      expect(removed).toBe(1);
      const left = await prisma.snapshot.findMany({ select: { id: true } });
      expect(left.map((row) => row.id).sort()).toEqual(
        [recent.id, live.id].sort(),
      );
      expect(old.id).toBeDefined();
    });

    /**
     * The deliberate part. An alert keeps its row and loses its frame: the
     * event is the record of what happened, and its copied label, type and
     * detection metrics still read without the bytes.
     */
    it('leaves an alert event standing when its frame is swept', async () => {
      const user = await seedUser();
      const space = await seedSpace(user.id);
      const camera = await seedCamera(space.id);
      const frame = await seedSnapshot(camera.id, WELL_BEFORE);
      const event = await prisma.alertEvent.create({
        data: {
          spaceId: space.id,
          cameraId: camera.id,
          cameraLabelSnapshot: 'Front door',
          alertType: 'intruder',
          detectedAt: WELL_BEFORE,
          snapshotId: frame.id,
          personsDetected: 1,
        },
      });

      await snapshotAccessor.deleteEvidenceBefore(CUTOFF, 100);

      const after = await prisma.alertEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
      expect(after.snapshotId).toBeNull();
      expect(after.cameraLabelSnapshot).toBe('Front door');
      expect(after.personsDetected).toBe(1);
    });
  });
});
