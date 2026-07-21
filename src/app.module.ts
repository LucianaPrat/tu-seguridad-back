import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { envValidationSchema } from './cross/config/env-validation.schema';
import { createPinoHttpOptions } from './cross/config/logger.options';
import { createThrottlerOptions } from './cross/config/throttler.options';
import { EitherInterceptor } from './cross/interceptors/either.interceptor';
import { HitInterceptor } from './cross/interceptors/hit.interceptor';
import { MetricsThrottlerGuard } from './cross/metrics/metrics-throttler.guard';
import { MetricsModule } from './cross/metrics/metrics.module';
import { DataModule } from './data/data.module';
import { AuthModule } from './modules/auth/auth.module';
import { CameraStatusModule } from './modules/cameras/camera-status.module';
import { CamerasModule } from './modules/cameras/cameras.module';
import { EventsModule } from './modules/events/events.module';
import { FaceAuthClientModule } from './modules/face-auth-client/face-auth-client.module';
import { HealthModule } from './modules/health/health.module';
import { ZonesModule } from './modules/zones/zones.module';

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
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createThrottlerOptions,
    }),
    MetricsModule,
    DataModule,
    AuthModule,
    HealthModule,
    CameraStatusModule,
    CamerasModule,
    ZonesModule,
    EventsModule,
    FaceAuthClientModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: EitherInterceptor },
    { provide: APP_INTERCEPTOR, useClass: HitInterceptor },
    { provide: APP_GUARD, useClass: MetricsThrottlerGuard },
  ],
})
export class AppModule {}
