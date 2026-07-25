import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Tu Seguridad API')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth')
    .addTag('cameras')
    .addTag('zones')
    .addTag('events')
    .addTag('health')
    .build();
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, buildSwaggerConfig());
}

export function setupSwagger(app: INestApplication): void {
  const document = createOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document);
}
