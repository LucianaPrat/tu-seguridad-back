import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { DatabaseHealthAccessor } from '../../data/accessors/database-health.accessor';

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly databaseHealthAccessor: DatabaseHealthAccessor,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async pingCheck<Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const check = this.healthIndicatorService.check(key);
    try {
      await this.databaseHealthAccessor.ping();
      return check.up();
    } catch (error) {
      return check.down({
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
}
