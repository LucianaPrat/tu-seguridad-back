import { HealthController } from './health.controller';

describe('HealthController', () => {
  let healthCheckService: { check: jest.Mock };
  let prismaHealthIndicator: { pingCheck: jest.Mock };
  let faceAuthHealthIndicator: { isHealthy: jest.Mock };
  let controller: HealthController;

  beforeEach(() => {
    healthCheckService = {
      check: jest.fn().mockResolvedValue({ status: 'ok' }),
    };
    prismaHealthIndicator = { pingCheck: jest.fn() };
    faceAuthHealthIndicator = { isHealthy: jest.fn() };
    controller = new HealthController(
      healthCheckService as never,
      prismaHealthIndicator as never,
      faceAuthHealthIndicator as never,
    );
  });

  it('live() runs an empty health check (process liveness only)', async () => {
    await controller.live();

    expect(healthCheckService.check).toHaveBeenCalledWith([]);
  });

  it('ready() checks database connectivity', async () => {
    await controller.ready();

    const [indicators] = healthCheckService.check.mock.calls[0] as [
      Array<() => unknown>,
    ];
    expect(indicators).toHaveLength(1);

    await indicators[0]();
    expect(prismaHealthIndicator.pingCheck).toHaveBeenCalledWith('db');
  });

  it('dependencies() checks face-auth reachability, not the database', async () => {
    await controller.dependencies();

    const [indicators] = healthCheckService.check.mock.calls[0] as [
      Array<() => unknown>,
    ];
    expect(indicators).toHaveLength(1);

    await indicators[0]();
    expect(faceAuthHealthIndicator.isHealthy).toHaveBeenCalledWith('face-auth');
    expect(prismaHealthIndicator.pingCheck).not.toHaveBeenCalled();
  });
});
