import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvNames } from '../../cross/common/constants';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        timeout: config.get<number>(EnvNames.ASSISTANT_TIMEOUT_MS),
      }),
    }),
  ],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
