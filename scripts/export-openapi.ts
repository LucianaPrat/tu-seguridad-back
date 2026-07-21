import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { createOpenApiDocument } from '../src/cross/config/swagger.config';

// Boots the DI container far enough to introspect routes (same sequence as
// main.ts up to, but not including, app.listen()) and writes the OpenAPI
// document to openapi.json. Never calls app.init()/listen(), so it needs no
// database or network — mirrors how setupSwagger builds the live /docs-json.
async function main() {
  const outPath = process.argv[2]
    ? join(process.cwd(), process.argv[2])
    : join(__dirname, '..', 'openapi.json');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });
  app.setGlobalPrefix('api', { exclude: ['docs', 'health/(.*)'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const document = createOpenApiDocument(app);
  writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n');

  await app.close();

  console.log(`openapi.json written to ${outPath}`);
}

void main();
