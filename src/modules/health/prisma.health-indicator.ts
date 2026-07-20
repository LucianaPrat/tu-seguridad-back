import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { PrismaService } from '../../data/prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async pingCheck<Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const check = this.healthIndicatorService.check(key);
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return check.up();
    } catch (error) {
      return check.down({
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
}
