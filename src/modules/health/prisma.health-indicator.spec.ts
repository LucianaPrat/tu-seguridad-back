import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health-indicator';

describe('PrismaHealthIndicator', () => {
  let databaseHealthAccessor: { ping: jest.Mock };
  let indicator: PrismaHealthIndicator;

  beforeEach(() => {
    databaseHealthAccessor = { ping: jest.fn() };
    indicator = new PrismaHealthIndicator(
      databaseHealthAccessor as never,
      new HealthIndicatorService(),
    );
  });

  it('reports up when the database responds', async () => {
    databaseHealthAccessor.ping.mockResolvedValue(undefined);

    const result = await indicator.pingCheck('db');

    expect(result).toEqual({ db: { status: 'up' } });
  });

  it('reports down with the error message when the database is unreachable', async () => {
    databaseHealthAccessor.ping.mockRejectedValue(
      new Error('connection refused'),
    );

    const result = await indicator.pingCheck('db');

    expect(result).toEqual({
      db: { status: 'down', message: 'connection refused' },
    });
  });
});
