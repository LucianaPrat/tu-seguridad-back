import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Tu Seguridad API')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth')
    .addTag('cameras')
    .addTag('zones')
    .addTag('events')
    .addTag('health')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
}
