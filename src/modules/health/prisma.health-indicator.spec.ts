import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health-indicator';

describe('PrismaHealthIndicator', () => {
  let prisma: { $queryRaw: jest.Mock };
  let indicator: PrismaHealthIndicator;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    indicator = new PrismaHealthIndicator(
      prisma as never,
      new HealthIndicatorService(),
    );
  });

  it('reports up when the database responds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);

    const result = await indicator.pingCheck('db');

    expect(result).toEqual({ db: { status: 'up' } });
  });

  it('reports down with the error message when the database is unreachable', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    const result = await indicator.pingCheck('db');

    expect(result).toEqual({
      db: { status: 'down', message: 'connection refused' },
    });
  });
});
