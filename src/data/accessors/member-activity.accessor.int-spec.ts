import { truncateAll } from '../../../test/utils/truncate-all';
import { PrismaService } from '../prisma/prisma.service';
import { MemberActivityAccessorService } from './member-activity.accessor';

const T0 = new Date('2026-09-01T10:00:00.000Z');
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);

/** The session gap lives in SQL, so it is asserted against a real MySQL. */
describe('member activity accessor (int)', () => {
  const prisma = new PrismaService({
    datasourceUrl: process.env.DATABASE_URL_TEST,
  });
  const accessor = new MemberActivityAccessorService(prisma);

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());
  beforeEach(() => truncateAll(prisma));

  const hit = (userId: number | null, createdAt: Date) =>
    prisma.hit.create({
      data: {
        method: 'GET',
        route: '/x',
        statusCode: 200,
        durationMs: 1,
        isError: false,
        userId,
        createdAt,
      },
    });

  it('starts a session after more than 30 minutes, not at exactly 30', async () => {
    for (const m of [0, 30, 60, 91]) await hit(1, plus(m));
    await hit(2, plus(5));
    await hit(null, plus(5));

    const starts = await accessor.findSessionStarts([1], T0);

    // 0 starts; 30 and 60 are exactly 30 after their predecessor; 91 is 31.
    expect(starts).toEqual([
      { userId: 1, at: plus(0) },
      { userId: 1, at: plus(91) },
    ]);
  });

  it('returns nothing for an empty roster and the max hit per user', async () => {
    await hit(1, plus(0));
    await hit(1, plus(500));
    await hit(2, plus(7));

    expect(await accessor.findSessionStarts([], T0)).toEqual([]);
    expect(await accessor.lastAccess([])).toEqual([]);
    expect(await accessor.lastAccess([1, 3])).toEqual([
      { userId: 1, at: plus(500) },
    ]);
  });
});
