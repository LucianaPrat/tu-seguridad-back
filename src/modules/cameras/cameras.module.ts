import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { EnvNames } from '../../cross/common/constants';
import { PipelineModule } from '../pipeline/pipeline.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { StreamingModule } from '../streaming/streaming.module';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';

/**
 * The bound on the analyze upload, and the reason it lives here rather than in
 * the service: multer buffers the whole body in memory before any handler
 * runs, so a check that reads `buffer.byteLength` has already paid for the
 * allocation it is trying to refuse. This is the only place that can stop it.
 *
 * It reads `SNAPSHOT_MAX_BYTES`, the same variable `CamerasService.analyze`
 * compares against, because a frame that raises an alert is stored: accepting
 * one this process could not persist would only fail later. Two numbers drift.
 */
export const createUploadOptions = (config: ConfigService): MulterOptions => ({
  limits: {
    fileSize: config.getOrThrow<number>(EnvNames.SNAPSHOT_MAX_BYTES),
    files: 1,
  },
});

@Module({
  imports: [
    PipelineModule,
    SnapshotsModule,
    StreamingModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: createUploadOptions,
    }),
  ],
  controllers: [CamerasController],
  providers: [CamerasService],
})
export class CamerasModule {}
