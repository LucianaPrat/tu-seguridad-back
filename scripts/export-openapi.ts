import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/cross/config/configure-app';
import { createOpenApiDocument } from '../src/cross/config/swagger.config';

// Boots the DI container far enough to introspect routes and writes the
// OpenAPI document to openapi.json. The route shape comes from `configureApp`,
// the same function main.ts and the e2e harness call, so this can no longer
// drift from the app it documents. Never calls app.init()/listen(), so it needs
// no database or network.
async function main() {
  const outPath = process.argv[2]
    ? join(process.cwd(), process.argv[2])
    : join(__dirname, '..', 'openapi.json');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });
  configureApp(app);

  const document = createOpenApiDocument(app);
  writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n');

  await app.close();

  console.log(`openapi.json written to ${outPath}`);
}

void main();
