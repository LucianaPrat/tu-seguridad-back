import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { validationExceptionFactory } from '../errors/validation-exception.factory';

/**
 * The bootstrap every entry point has to apply identically.
 *
 * There are three of them — `main.ts`, `scripts/export-openapi.ts` and the e2e
 * harness — and until this existed each replayed the sequence by hand. None of
 * it comes free from `AppModule`: the prefix, the versioning and the pipes live
 * on the `INestApplication` instance, so a harness that forgets one boots a
 * subtly different app than production and every spec passes against it. The
 * `metrics` exclusion was already missing from the e2e harness for exactly that
 * reason.
 *
 * What stays at the call site is what genuinely differs: the middleware that
 * needs configuration (helmet, CORS, compression, the WebSocket adapter),
 * whether the docs are served, shutdown hooks, and listening at all. The export
 * script has no config and no network; the e2e harness fakes three ports.
 */
export function configureApp(app: INestApplication): void {
  // The refresh route reads its token off `req.cookies`, so the parser is not
  // optional in any of the three.
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  // `metrics` is excluded here and not only in production: the throttling suite
  // reads it, and a route that lands somewhere else under test is the drift
  // this function exists to remove.
  app.setGlobalPrefix('api', {
    exclude: ['docs', 'health/(.*)', 'metrics'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
}
