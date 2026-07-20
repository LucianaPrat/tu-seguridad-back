import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvNames } from '../../cross/common/constants';
import { FaceAuthClientService } from './face-auth-client.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        timeout: config.get<number>(EnvNames.DETECT_TIMEOUT_MS),
      }),
    }),
  ],
  providers: [FaceAuthClientService],
  exports: [FaceAuthClientService],
})
export class FaceAuthClientModule {}
