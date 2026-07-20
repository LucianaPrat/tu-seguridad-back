import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvNames } from '../../cross/common/constants';
import { EventsModule } from '../events/events.module';
import { FaceAuthClientModule } from '../face-auth-client/face-auth-client.module';
import { OccupancyEngine } from './occupancy.engine';
import { PipelineService } from './pipeline.service';
import { PollingScheduler } from './polling.scheduler';
import { SnapshotService } from './snapshot.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    FaceAuthClientModule,
    EventsModule,
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        timeout: config.get<number>(EnvNames.SNAPSHOT_TIMEOUT_MS),
      }),
    }),
  ],
  providers: [
    SnapshotService,
    PipelineService,
    PollingScheduler,
    OccupancyEngine,
  ],
  exports: [PipelineService],
})
export class PipelineModule {}
