import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { envValidationSchema } from './cross/config/env-validation.schema';
import { createPinoHttpOptions } from './cross/config/logger.options';
import { EitherInterceptor } from './cross/interceptors/either.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: createPinoHttpOptions(config),
      }),
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: EitherInterceptor },
  ],
})
export class AppModule {}
