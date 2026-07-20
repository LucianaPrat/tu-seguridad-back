import { PrismaService } from '../prisma/prisma.service';
import { HitAccessorService } from './hit.accessor';

describe('HitAccessorService (int)', () => {
  const prisma = new PrismaService({
    datasourceUrl: process.env.DATABASE_URL_TEST,
  });
  const accessor = new HitAccessorService(prisma);

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

  it('creates a hit with a full payload and returns generated id/createdAt', async () => {
    const created = await accessor.create({
      method: 'GET',
      route: '/cameras',
      statusCode: 200,
      durationMs: 12,
      userId: 42,
      isError: false,
    });

    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.method).toBe('GET');
    expect(created.userId).toBe(42);
  });

  it('creates a hit with userId omitted/null', async () => {
    const created = await accessor.create({
      method: 'POST',
      route: '/auth/login',
      statusCode: 401,
      durationMs: 5,
      isError: true,
    });

    expect(created.id).toBeDefined();
    expect(created.userId).toBeNull();
  });
});
