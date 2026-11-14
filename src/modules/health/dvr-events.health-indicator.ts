import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { DvrEventListener } from '../pipeline/dvr-event.listener';

/**
 * Whether every configured recorder has its event connection open.
 *
 * Counts only. The route is public, and a per-space breakdown would publish
 * tenant ids and, worse, when somebody last moved in front of a camera; that
 * detail is behind auth at `GET /api/v1/dvr/events`.
 *
 * "Connected" already means "heard within `DVR_EVENTS_IDLE_SECONDS`": the
 * listener's watchdog drops a connection that goes quiet, heartbeat included,
 * so an unplugged recorder turns this down within that window.
 */
@Injectable()
export class DvrEventsHealthIndicator {
  constructor(
    private readonly listener: DvrEventListener,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy<Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const check = this.healthIndicatorService.check(key);
    if (!this.listener.enabled) {
      return check.up({ enabled: false });
    }
    try {
      const statuses = await this.listener.statuses();
      const connected = statuses.filter((status) => status.connected).length;
      const details = { recorders: statuses.length, connected };
      return connected === statuses.length
        ? check.up(details)
        : check.down({
            ...details,
            message: `${statuses.length - connected} recorder(s) without an event connection`,
          });
    } catch (error) {
      return check.down({
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}
