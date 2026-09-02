import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { DeliveryRetryService } from './delivery-retry.service';
import { RetentionService } from './retention.service';

/**
 * The scheduled jobs that are nobody's request: the retention sweeps and the
 * alert-delivery retry. One module rather than two, so there is one place to
 * look for "what does this process do on its own".
 *
 * No `ScheduleModule.forRoot()` here: `PipelineModule` already calls it, and
 * the explorer it installs discovers `@Cron` on every provider in the
 * application. A second `forRoot()` registers the explorer, and every job with
 * it, twice.
 */
@Module({
  imports: [EventsModule],
  providers: [RetentionService, DeliveryRetryService],
})
export class RetentionModule {}
