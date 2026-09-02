import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvNames } from '../../cross/common/constants';
import { EventsModule } from '../events/events.module';
import { FaceAuthClientModule } from '../face-auth-client/face-auth-client.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { CadenceEngine } from './cadence.engine';
import { OccupancyEngine } from './occupancy.engine';
import { PipelineService } from './pipeline.service';
import { PollingScheduler } from './polling.scheduler';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    FaceAuthClientModule,
    SnapshotsModule,
    EventsModule,
  ],
  providers: [
    PipelineService,
    PollingScheduler,
    // Built from configuration rather than constructed by Nest: the hysteresis
    // thresholds are env-tunable, and a plain `providers: [OccupancyEngine]`
    // entry would silently keep the constructor defaults instead.
    {
      provide: OccupancyEngine,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OccupancyEngine(
          config.getOrThrow<number>(EnvNames.ENTER_CONSECUTIVE_POLLS),
          config.getOrThrow<number>(EnvNames.EXIT_CONSECUTIVE_POLLS),
        ),
    },
    {
      provide: CadenceEngine,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new CadenceEngine(
          config.getOrThrow<number>(EnvNames.POLLING_PASSIVE_SECONDS),
          config.getOrThrow<number>(EnvNames.POLLING_ACTIVE_SECONDS),
          config.getOrThrow<number>(EnvNames.POLLING_DETECTION_SECONDS),
        ),
    },
  ],
  exports: [PipelineService, PollingScheduler],
})
export class PipelineModule {}
