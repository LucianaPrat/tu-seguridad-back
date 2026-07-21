import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { EnvNames } from '../src/cross/common/constants';
import {
  encryptField,
  looksEncrypted,
  normalizeEncryptionKey,
} from '../src/cross/crypto/field-encryption';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/data/prisma/prisma.service';

// One-off, run MANUALLY once against a database whose snapshot_url values are
// still plaintext (never wired into CI). Writes ciphertext back directly via
// Prisma, bypassing the accessor so values are not double-encrypted. Idempotent:
// rows already in "iv:tag:ciphertext" shape are skipped.
//   SNAPSHOT_URL_ENCRYPTION_KEY=<prod key> npx ts-node scripts/encrypt-existing-snapshot-urls.ts
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const prisma = app.get(PrismaService);
    const config = app.get(ConfigService);
    const key = normalizeEncryptionKey(
      config.get<string>(EnvNames.SNAPSHOT_URL_ENCRYPTION_KEY)!,
    );

    const cameras = await prisma.camera.findMany({
      select: { id: true, snapshotUrl: true },
    });

    let encrypted = 0;
    let skipped = 0;
    for (const camera of cameras) {
      if (looksEncrypted(camera.snapshotUrl)) {
        skipped++;
        continue;
      }
      await prisma.camera.update({
        where: { id: camera.id },
        data: { snapshotUrl: encryptField(camera.snapshotUrl, key) },
      });
      encrypted++;
    }

    console.log(
      `snapshotUrl encryption complete: ${encrypted} encrypted, ${skipped} already encrypted (${cameras.length} total)`,
    );
  } finally {
    await app.close();
  }
}

void main();
