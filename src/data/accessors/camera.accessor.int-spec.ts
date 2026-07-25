import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { EnvNames } from '../../cross/common/constants';
import { PrismaService } from '../prisma/prisma.service';
import { CameraAccessorService } from './camera.accessor';

const TEST_ENCRYPTION_KEY =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('CameraAccessorService (int)', () => {
  const prisma = new PrismaService({
    datasourceUrl: process.env.DATABASE_URL_TEST,
  });
  const configService = {
    get: (key: string) =>
      key === EnvNames.SNAPSHOT_URL_ENCRYPTION_KEY
        ? TEST_ENCRYPTION_KEY
        : undefined,
  } as unknown as ConfigService;
  const accessor = new CameraAccessorService(prisma, configService);

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

  it('encrypts snapshotUrl at rest and decrypts on read', async () => {
    const id = randomUUID();
    const plaintext = 'http://user:pass@dvr.local/snap.jpg';

    await accessor.create({
      id,
      name: 'Encrypted cam',
      snapshotUrl: plaintext,
    });

    const rows = await prisma.$queryRaw<{ snapshot_url: string }[]>`
      SELECT snapshot_url FROM cameras WHERE id = ${id}
    `;
    expect(rows[0].snapshot_url).not.toBe(plaintext);
    expect(rows[0].snapshot_url).not.toContain('dvr.local');
    expect(rows[0].snapshot_url).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);

    const found = await accessor.findById(id);
    expect(found?.snapshotUrl).toBe(plaintext);
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
