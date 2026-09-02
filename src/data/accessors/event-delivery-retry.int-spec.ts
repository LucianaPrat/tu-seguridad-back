import { EventDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { truncateAll } from '../../../test/utils/truncate-all';
import { EventDeliveryAccessorService } from './event-delivery.accessor';

const MINUTE_MS = 60 * 1000;
const NOW = new Date('2026-09-01T12:00:00.000Z');
const BEFORE = new Date(NOW.getTime() - 5 * MINUTE_MS);
const STALE = new Date(BEFORE.getTime() - MINUTE_MS);
const FRESH = new Date(NOW.getTime() - MINUTE_MS);

/**
 * What the retry sweep is allowed to pick up, and what a retry may overwrite.
 * Both are decided in `where` clauses, so both are asserted against a real
 * database rather than a mocked query.
 */
describe('event delivery retry (int)', () => {
  const prisma = new PrismaService({
    datasourceUrl: process.env.DATABASE_URL_TEST,
  });
  const accessor = new EventDeliveryAccessorService(prisma);

  let spaceId: string;
  let userId: number;
  let eventId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    const user = await prisma.user.create({
      data: {
        email: 'owner@example.com',
        passwordHash: 'bcrypt-hash',
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '+5491122334455',
        profileCompleted: true,
      },
    });
    userId = user.id;
    const space = await prisma.space.create({
      data: { name: 'My Secure Space', ownerUserId: user.id },
    });
    spaceId = space.id;
    const event = await prisma.alertEvent.create({
      data: {
        spaceId,
        cameraLabelSnapshot: 'Front door',
        alertType: 'intruder',
        detectedAt: NOW,
      },
    });
    eventId = event.id;
  });

  async function seedDelivery(
    correlationId: string,
    overrides: {
      channel?: 'email' | 'whatsapp' | 'call';
      status?: EventDeliveryStatus;
      attempts?: number;
      updatedAt?: Date;
    } = {},
  ) {
    const row = await prisma.eventDelivery.create({
      data: {
        eventId,
        recipientUserId: userId,
        correlationId,
        channel: overrides.channel ?? 'email',
        status: overrides.status ?? EventDeliveryStatus.failed,
        attempts: overrides.attempts ?? 1,
      },
    });
    // `updatedAt` is `@updatedAt`, so Prisma owns it on write. Backdating is
    // the only way to rehearse a row that has been sitting there.
    if (overrides.updatedAt) {
      await prisma.$executeRaw`UPDATE event_deliveries SET updated_at = ${overrides.updatedAt} WHERE id = ${row.id}`;
    }
    return row;
  }

  describe('findRetryable', () => {
    it('picks up a failed row that has been sitting past the delay', async () => {
      const stuck = await seedDelivery('c1', { updatedAt: STALE });

      const found = await accessor.findRetryable(BEFORE, 3, 50);

      expect(found.map((row) => row.id)).toEqual([stuck.id]);
      expect(found[0].event.spaceId).toBe(spaceId);
    });

    it('leaves a row that was touched moments ago', async () => {
      await seedDelivery('c1', { updatedAt: FRESH });

      expect(await accessor.findRetryable(BEFORE, 3, 50)).toEqual([]);
    });

    it('leaves a row that reached the attempt cap', async () => {
      await seedDelivery('c1', { attempts: 3, updatedAt: STALE });

      expect(await accessor.findRetryable(BEFORE, 3, 50)).toEqual([]);
    });

    it('picks up a pending row a crash left behind', async () => {
      const stranded = await seedDelivery('c1', {
        status: EventDeliveryStatus.pending,
        attempts: 0,
        updatedAt: STALE,
      });

      const found = await accessor.findRetryable(BEFORE, 3, 50);

      expect(found.map((row) => row.id)).toEqual([stranded.id]);
    });

    /**
     * Their rows are pending because nobody ever built a sender, not because a
     * send did not finish. Picking them up would spin on them forever.
     */
    it('never picks up a call or whatsapp row', async () => {
      await seedDelivery('c1', {
        channel: 'whatsapp',
        status: EventDeliveryStatus.pending,
        attempts: 0,
        updatedAt: STALE,
      });
      await seedDelivery('c2', {
        channel: 'call',
        status: EventDeliveryStatus.pending,
        attempts: 0,
        updatedAt: STALE,
      });

      expect(await accessor.findRetryable(BEFORE, 3, 50)).toEqual([]);
    });

    it('leaves a delivered or sent row alone', async () => {
      await seedDelivery('c1', {
        status: EventDeliveryStatus.delivered,
        updatedAt: STALE,
      });
      await seedDelivery('c2', {
        status: EventDeliveryStatus.sent,
        updatedAt: STALE,
      });

      expect(await accessor.findRetryable(BEFORE, 3, 50)).toEqual([]);
    });

    it('never returns more than the batch it was asked for', async () => {
      await seedDelivery('c1', { updatedAt: STALE });
      await seedDelivery('c2', { updatedAt: STALE });
      await seedDelivery('c3', { updatedAt: STALE });

      expect(await accessor.findRetryable(BEFORE, 3, 2)).toHaveLength(2);
    });
  });

  describe('recording a retried attempt', () => {
    it('counts every attempt against the row', async () => {
      const row = await seedDelivery('c1', { attempts: 1 });

      await accessor.markFailed(row.id, 'relay refused');

      const after = await prisma.eventDelivery.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.attempts).toBe(2);
      expect(after.error).toBe('relay refused');
    });

    it('lets a retry of a failed row succeed', async () => {
      const row = await seedDelivery('c1');

      expect(await accessor.markSent(row.id, 'message-id')).toBe(true);

      const after = await prisma.eventDelivery.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.status).toBe(EventDeliveryStatus.sent);
      expect(after.attempts).toBe(2);
    });

    /**
     * The acknowledgement an operator actually made outranks a send that was
     * still in flight when it landed.
     */
    it('never overwrites a row an acknowledgement already claimed', async () => {
      const row = await seedDelivery('c1', {
        status: EventDeliveryStatus.delivered,
      });

      expect(await accessor.markSent(row.id, 'message-id')).toBe(false);
      expect(await accessor.markFailed(row.id, 'relay refused')).toBe(false);

      const after = await prisma.eventDelivery.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.status).toBe(EventDeliveryStatus.delivered);
      expect(after.attempts).toBe(1);
    });
  });
});
