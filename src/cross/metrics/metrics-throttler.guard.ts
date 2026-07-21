import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { MetricNames } from './metric-names';

/**
 * ThrottlerGuard that counts every 429 it throws. Re-injects the parent's deps
 * explicitly (extending a Nest provider drops constructor DI metadata otherwise).
 */
@Injectable()
export class MetricsThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @InjectMetric(MetricNames.THROTTLER_REJECTIONS_TOTAL)
    private readonly rejections: Counter<string>,
  ) {
    super(options, storageService, reflector);
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    this.rejections.inc();
    return super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
