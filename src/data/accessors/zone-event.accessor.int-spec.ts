import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ZoneEventAccessorService } from './zone-event.accessor';

describe('ZoneEventAccessorService (int)', () => {
  const prisma = new PrismaService({
    datasourceUrl: process.env.DATABASE_URL_TEST,
  });
  const accessor = new ZoneEventAccessorService(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$transaction([
      prisma.zoneEvent.deleteMany(),
      prisma.zone.deleteMany(),
      prisma.camera.deleteMany(),
      prisma.user.deleteMany(),
      prisma.hit.deleteMany(),
    ]);
  });

  const polygon = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ];

  async function seedEvents() {
    const camera1Id = randomUUID();
    const camera2Id = randomUUID();
    await prisma.camera.create({
      data: {
        id: camera1Id,
        name: 'Camera 1',
        snapshotUrl: 'https://example.com/1.jpg',
      },
    });
    await prisma.camera.create({
      data: {
        id: camera2Id,
        name: 'Camera 2',
        snapshotUrl: 'https://example.com/2.jpg',
      },
    });

    const zone1Id = randomUUID();
    const zone2Id = randomUUID();
    await prisma.zone.create({
      data: { id: zone1Id, cameraId: camera1Id, name: 'Zone 1', polygon },
    });
    await prisma.zone.create({
      data: { id: zone2Id, cameraId: camera2Id, name: 'Zone 2', polygon },
    });

    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date('2026-01-01T00:10:00.000Z');
    const t2 = new Date('2026-01-01T00:20:00.000Z');
    const t3 = new Date('2026-01-01T00:30:00.000Z');

    const e1 = await accessor.create({
      eventId: randomUUID(),
      eventType: 'PERSON_ENTERED_ZONE',
      cameraId: camera1Id,
      zoneId: zone1Id,
      occurredAt: t0,
      personsInZone: 1,
    });
    const e2 = await accessor.create({
      eventId: randomUUID(),
      eventType: 'PERSON_EXITED_ZONE',
      cameraId: camera1Id,
      zoneId: zone1Id,
      occurredAt: t1,
      personsInZone: 0,
    });
    const e3 = await accessor.create({
      eventId: randomUUID(),
      eventType: 'PERSON_ENTERED_ZONE',
      cameraId: camera2Id,
      zoneId: zone2Id,
      occurredAt: t2,
      personsInZone: 1,
    });
    const e4 = await accessor.create({
      eventId: randomUUID(),
      eventType: 'PERSON_ENTERED_ZONE',
      cameraId: camera1Id,
      zoneId: zone1Id,
      occurredAt: t3,
      personsInZone: 2,
    });

    return {
      camera1Id,
      camera2Id,
      zone1Id,
      zone2Id,
      t0,
      t1,
      t2,
      t3,
      e1,
      e2,
      e3,
      e4,
    };
  }

  it('creates a zone event and returns the generated row', async () => {
    const { e1 } = await seedEvents();

    expect(e1.id).toBeDefined();
    expect(e1.personsInZone).toBe(1);
  });

  it('filters by cameraId', async () => {
    const { camera1Id, e1, e2, e4 } = await seedEvents();

    const results = await accessor.query({ cameraId: camera1Id });

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.id).sort()).toEqual(
      [e1.id, e2.id, e4.id].sort(),
    );
  });

  it('filters by zoneId', async () => {
    const { zone2Id, e3 } = await seedEvents();

    const results = await accessor.query({ zoneId: zone2Id });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(e3.id);
  });

  it('filters by eventType', async () => {
    const { e2 } = await seedEvents();

    const results = await accessor.query({ eventType: 'PERSON_EXITED_ZONE' });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(e2.id);
  });

  it('filters by from/to date range', async () => {
    const { t1, t2, e2, e3 } = await seedEvents();

    const results = await accessor.query({ from: t1, to: t2 });

    expect(results.map((r) => r.id).sort()).toEqual([e2.id, e3.id].sort());
  });

  it('orders results by occurredAt descending', async () => {
    const { e1, e2, e3, e4 } = await seedEvents();

    const results = await accessor.query({});

    expect(results.map((r) => r.id)).toEqual([e4.id, e3.id, e2.id, e1.id]);
  });

  it('applies limit to return the newest N results', async () => {
    const { e3, e4 } = await seedEvents();

    const results = await accessor.query({ limit: 2 });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual([e4.id, e3.id]);
  });
});
