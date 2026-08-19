import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Tu Seguridad API')
    .setDescription(
      'Space-scoped video surveillance API. Every route outside `auth` and `health` ' +
        'resolves resources inside the caller space, taken from the bearer token, so an ' +
        'id from another space answers 404 rather than a result. Writes that change what ' +
        'the system watches are admin-only. Failures answer `{ statusCode, code, message }` ' +
        '— branch on `code`, not on the message.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addTag(
      'auth',
      'Login, registration, session rotation, password reset, magic links, face identity.',
    )
    .addTag(
      'invitations',
      'Admin-issued invitations to a space, and their acceptance.',
    )
    .addTag(
      'dvr',
      'The space recorder: credentials, connectivity and channel discovery.',
    )
    .addTag(
      'cameras',
      'Discovered cameras, monitor configuration, snapshots and manual analysis.',
    )
    .addTag(
      'zones',
      'Percentage-rectangle monitor areas inside a camera frame.',
    )
    .addTag('snapshots', 'Stored frame bytes. The only route that serves them.')
    .addTag('events', 'Alert history.')
    .addTag(
      'health',
      'Liveness, readiness and upstream reachability. Outside the API prefix.',
    )
    .build();
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, buildSwaggerConfig());
}

export function setupSwagger(app: INestApplication): void {
  const document = createOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document);
}
