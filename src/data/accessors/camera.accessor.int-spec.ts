import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CameraAccessorService } from './camera.accessor';

describe('CameraAccessorService (int)', () => {
  const prisma = new PrismaService({
    datasourceUrl: process.env.DATABASE_URL_TEST,
  });
  const accessor = new CameraAccessorService(prisma);

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
    const id = randomUUID();

    const created = await accessor.create({
      id,
      name: 'Front door',
      snapshotUrl: 'https://example.com/snapshot.jpg',
    });
    expect(created.id).toBe(id);
    expect(created.name).toBe('Front door');

    const found = await accessor.findById(id);
    expect(found?.id).toBe(id);

    const all = await accessor.findAll();
    expect(all.map((c) => c.id)).toContain(id);

    const updated = await accessor.update(id, { name: 'Back door' });
    expect(updated.name).toBe('Back door');

    await accessor.delete(id);
    const afterDelete = await accessor.findById(id);
    expect(afterDelete).toBeNull();
  });

  it('counts zones for a camera, 0 for fresh camera and N after creating zones', async () => {
    const cameraId = randomUUID();
    await accessor.create({
      id: cameraId,
      name: 'Camera with zones',
      snapshotUrl: 'https://example.com/snapshot.jpg',
    });

    expect(await accessor.countZones(cameraId)).toBe(0);

    await prisma.zone.create({
      data: {
        id: randomUUID(),
        cameraId,
        name: 'Zone A',
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    });
    await prisma.zone.create({
      data: {
        id: randomUUID(),
        cameraId,
        name: 'Zone B',
        polygon: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
        ],
      },
    });

    expect(await accessor.countZones(cameraId)).toBe(2);
  });

  it('rejects deleting a camera that still has zones (FK restrict)', async () => {
    const cameraId = randomUUID();
    await accessor.create({
      id: cameraId,
      name: 'Camera with a zone',
      snapshotUrl: 'https://example.com/snapshot.jpg',
    });
    await prisma.zone.create({
      data: {
        id: randomUUID(),
        cameraId,
        name: 'Zone A',
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    });

    await expect(accessor.delete(cameraId)).rejects.toThrow();
  });
});
