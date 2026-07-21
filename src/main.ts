import './observability/tracing';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { EnvNames } from './cross/common/constants';
import { SocketIoAdapter } from './cross/config/socket-io.adapter';
import { setupSwagger } from './cross/config/swagger.config';
import { validationExceptionFactory } from './cross/errors/validation-exception.factory';
import { initSentry } from './observability/sentry';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.set('trust proxy', 'loopback');
  app.use(helmet());

  const configService = app.get(ConfigService);
  const corsOrigins = configService
    .get<string>(EnvNames.CORS_ORIGINS, '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useWebSocketAdapter(new SocketIoAdapter(app, corsOrigins));

  app.use(compression());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.setGlobalPrefix('api', {
    exclude: ['docs', 'health/(.*)', 'metrics'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  setupSwagger(app);

  const port = configService.get<number>(EnvNames.PORT, 3000);
  await app.listen(port);
}

initSentry();
void bootstrap();
