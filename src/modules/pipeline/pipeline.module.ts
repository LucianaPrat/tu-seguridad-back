import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvNames } from '../../cross/common/constants';
import { FaceAuthClientModule } from '../face-auth-client/face-auth-client.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { OccupancyEngine } from './occupancy.engine';
import { PipelineService } from './pipeline.service';
import { PollingScheduler } from './polling.scheduler';

@Module({
  imports: [ScheduleModule.forRoot(), FaceAuthClientModule, SnapshotsModule],
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
  ],
  exports: [PipelineService],
})
export class PipelineModule {}
