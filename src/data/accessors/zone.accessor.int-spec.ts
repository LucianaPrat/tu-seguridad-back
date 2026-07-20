import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ZoneAccessorService } from './zone.accessor';

describe('ZoneAccessorService (int)', () => {
  const prisma = new PrismaService({
    datasourceUrl: process.env.DATABASE_URL_TEST,
  });
  const accessor = new ZoneAccessorService(prisma);

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

  it('performs a CRUD roundtrip', async () => {
    const cameraId = randomUUID();
    await prisma.camera.create({
      data: {
        id: cameraId,
        name: 'Camera for zones',
        snapshotUrl: 'https://example.com/snapshot.jpg',
      },
    });

    const zoneId = randomUUID();
    const initialPolygon = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    const created = await accessor.create({
      id: zoneId,
      cameraId,
      name: 'Entrance',
      polygon: initialPolygon,
    });
    expect(created.id).toBe(zoneId);
    expect(created.cameraId).toBe(cameraId);
    expect(created.geometryVersion).toBe(1);

    const found = await accessor.findById(zoneId);
    expect(found?.id).toBe(zoneId);

    const byCamera = await accessor.findByCamera(cameraId);
    expect(byCamera.map((z) => z.id)).toEqual([zoneId]);

    const newPolygon = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ];
    const updated = await accessor.update(zoneId, {
      geometryVersion: 2,
      polygon: newPolygon,
    });
    expect(updated.geometryVersion).toBe(2);
    expect(updated.polygon).toEqual(newPolygon);

    await accessor.delete(zoneId);
    const afterDelete = await accessor.findById(zoneId);
    expect(afterDelete).toBeNull();
  });
});
