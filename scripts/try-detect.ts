import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { AppModule } from '../src/app.module';
import { FaceAuthClientService } from '../src/modules/face-auth-client/face-auth-client.service';

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error('Usage: npx ts-node scripts/try-detect.ts <image.jpg>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const client = app.get(FaceAuthClientService);
    const image = readFileSync(imagePath);
    const result = await client.detectPersons(image, basename(imagePath));

    if (result.ok) {
      console.log(JSON.stringify(result.data.persons, null, 2));
    } else {
      console.error(`Detection failed: ${result.code} - ${result.message}`);
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main();
