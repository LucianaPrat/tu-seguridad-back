import { HealthIndicatorService } from '@nestjs/terminus';
import { DvrEventStatus } from '../pipeline/dvr-event.listener';
import { DvrEventsHealthIndicator } from './dvr-events.health-indicator';

const status = (connected: boolean): DvrEventStatus => ({
  connected,
  since: new Date(),
  lastHeardAt: null,
  lastMotionAt: null,
  lastDrop: connected ? null : 'idle',
});

describe(DvrEventsHealthIndicator.name, () => {
  let listener: { enabled: boolean; statuses: jest.Mock };
  let indicator: DvrEventsHealthIndicator;

  beforeEach(() => {
    listener = { enabled: true, statuses: jest.fn() };
    indicator = new DvrEventsHealthIndicator(
      listener as never,
      new HealthIndicatorService(),
    );
  });

  it('reports up without asking anything when events are off', async () => {
    listener.enabled = false;

    const result = await indicator.isHealthy('dvr-events');

    expect(result).toEqual({ 'dvr-events': { status: 'up', enabled: false } });
    expect(listener.statuses).not.toHaveBeenCalled();
  });

  it('reports up when every recorder is connected', async () => {
    listener.statuses.mockResolvedValue([status(true), status(true)]);

    const result = await indicator.isHealthy('dvr-events');

    expect(result).toEqual({
      'dvr-events': { status: 'up', recorders: 2, connected: 2 },
    });
  });

  it('reports down, with counts only, when one recorder is not connected', async () => {
    listener.statuses.mockResolvedValue([status(true), status(false)]);

    const result = await indicator.isHealthy('dvr-events');

    expect(result).toEqual({
      'dvr-events': {
        status: 'down',
        recorders: 2,
        connected: 1,
        message: '1 recorder(s) without an event connection',
      },
    });
  });

  it('reports down when the recorders cannot be read', async () => {
    listener.statuses.mockRejectedValue(new Error('db gone'));

    const result = await indicator.isHealthy('dvr-events');

    expect(result).toEqual({
      'dvr-events': { status: 'down', message: 'db gone' },
    });
  });
});
