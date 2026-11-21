import './observability/tracing';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { EnvNames } from './cross/common/constants';
import { configureApp } from './cross/config/configure-app';
import { SocketIoAdapter } from './cross/config/socket-io.adapter';
import { setupSwagger } from './cross/config/swagger.config';
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
  configureApp(app);
  app.enableShutdownHooks();

  // The docs are a full inventory of the routes, their bodies and their failure
  // codes — what a developer needs, and what a stranger should not be handed.
  // Default is off in production, on everywhere else; `scripts/export-openapi.ts`
  // builds the document directly and is unaffected either way.
  if (configService.get<boolean>(EnvNames.SWAGGER_ENABLED)) {
    setupSwagger(app);
  }

  const port = configService.get<number>(EnvNames.PORT, 3000);
  await app.listen(port);
}

initSentry();
void bootstrap();
