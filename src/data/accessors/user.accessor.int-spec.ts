import { PrismaService } from '../prisma/prisma.service';
import { UserAccessorService } from './user.accessor';

describe('UserAccessorService (int)', () => {
  const prisma = new PrismaService({
    datasourceUrl: process.env.DATABASE_URL_TEST,
  });
  const accessor = new UserAccessorService(prisma);

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

  it('finds a user by email after it is created directly via prisma', async () => {
    await prisma.user.create({
      data: {
        email: 'someone@example.com',
        passwordHash: 'hashed-password',
      },
    });

    const found = await accessor.findByEmail('someone@example.com');

    expect(found).not.toBeNull();
    expect(found?.email).toBe('someone@example.com');
  });

  it('returns null for an email that does not exist', async () => {
    const found = await accessor.findByEmail('missing@example.com');

    expect(found).toBeNull();
  });
});
