import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { EnvNames } from '../../cross/common/constants';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

/**
 * The bound on the voice clip upload, here for the same reason the camera one
 * is in `cameras.module.ts`: multer buffers the whole body before any handler
 * runs, so a check that reads `buffer.byteLength` has already paid for the
 * allocation it wants to refuse. This is the only place that can stop it.
 *
 * Its own variable rather than `SNAPSHOT_MAX_BYTES`: a frame and a spoken
 * question are different sizes and the two limits have no reason to move
 * together.
 */
export const createAssistantUploadOptions = (
  config: ConfigService,
): MulterOptions => ({
  limits: {
    fileSize: config.getOrThrow<number>(EnvNames.ASSISTANT_AUDIO_MAX_BYTES),
    files: 1,
  },
});

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        timeout: config.get<number>(EnvNames.ASSISTANT_TIMEOUT_MS),
      }),
    }),
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: createAssistantUploadOptions,
    }),
  ],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
