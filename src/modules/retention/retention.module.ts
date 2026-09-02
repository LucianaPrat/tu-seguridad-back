import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';

/**
 * No `ScheduleModule.forRoot()` here: `PipelineModule` already calls it, and
 * the explorer it installs discovers `@Cron` on every provider in the
 * application. A second `forRoot()` registers the explorer twice and every job
 * with it.
 */
@Module({
  providers: [RetentionService],
})
export class RetentionModule {}
