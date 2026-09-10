import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvNames } from '../../cross/common/constants';
import { DvrModule } from '../dvr/dvr.module';
import { EventsModule } from '../events/events.module';
import { FaceAuthClientModule } from '../face-auth-client/face-auth-client.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { AlertCooldown } from './alert-cooldown';
import { CadenceEngine } from './cadence.engine';
import { DvrEventListener } from './dvr-event.listener';
import { OccupancyEngine } from './occupancy.engine';
import { PipelineService } from './pipeline.service';
import { PollingScheduler } from './polling.scheduler';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // The listener lives here and not in `DvrModule` because it needs
    // `PollingScheduler`, and that pair the other way round is a cycle and a
    // `forwardRef`. This edge is acyclic: `DvrModule` imports only `HttpModule`.
    DvrModule,
    FaceAuthClientModule,
    SnapshotsModule,
    EventsModule,
  ],
  providers: [
    PipelineService,
    PollingScheduler,
    // A plain provider, not a factory: the three below are built by hand
    // because they take plain numbers in their constructors, while the
    // listener reads its two from `ConfigService` where it uses them — so
    // retuning one takes effect on the next event, not the next restart.
    DvrEventListener,
    // Built from configuration rather than constructed by Nest: the hysteresis
    // thresholds are env-tunable, and a plain `providers: [OccupancyEngine]`
    // entry would silently keep the constructor defaults instead.
    {
      provide: OccupancyEngine,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OccupancyEngine(
          config.getOrThrow<number>(EnvNames.ENTER_HITS_REQUIRED),
          config.getOrThrow<number>(EnvNames.ENTER_WINDOW_POLLS),
          config.getOrThrow<number>(EnvNames.EXIT_CONSECUTIVE_POLLS),
        ),
    },
    {
      provide: AlertCooldown,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new AlertCooldown(
          config.getOrThrow<number>(EnvNames.ALERT_COOLDOWN_SECONDS),
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
  exports: [PipelineService, PollingScheduler, DvrEventListener],
})
export class PipelineModule {}
