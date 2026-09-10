import { NestFactory } from '@nestjs/core';
import { SnapshotReason } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { SnapshotAccessorService } from '../src/data/accessors/snapshot.accessor';

/**
 * A recall ledger that only ever sits in the database proves nothing: the
 * point of keeping the misses is to re-run them past the detector once it
 * changes, and that requires the raw bytes back on disk as files. This is
 * that hand-off — it drains `ledger_miss` rows into a directory laid out the
 * way `scripts/try-detect.ts` already expects.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 200;

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/jpeg') {
    return '.jpg';
  }
  return `.${mimeType.split('/')[1]}`;
}

async function main(): Promise<void> {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error(
      'Usage: npx ts-node scripts/export-ledger.ts <outDir> [fromISO] [toISO] [limit]',
    );
    process.exit(1);
  }

  const now = new Date();
  const from = process.argv[3]
    ? new Date(process.argv[3])
    : new Date(now.getTime() - 7 * DAY_MS);
  const to = process.argv[4] ? new Date(process.argv[4]) : now;
  const limit = Number(process.argv[5]) || DEFAULT_LIMIT;

  console.log(
    `window ${from.toISOString()} .. ${to.toISOString()} (limit ${limit})`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const snapshotAccessor = app.get(SnapshotAccessorService);
    const rows = await snapshotAccessor.listByReason(
      SnapshotReason.ledger_miss,
      from,
      to,
      limit,
    );

    if (rows.length === 0) {
      console.log(
        'No ledger_miss rows in that window. Check SNAPSHOT_KEEP_MISSES is on.',
      );
      return;
    }

    mkdirSync(outDir, { recursive: true });
    for (const row of rows) {
      const stamp = row.capturedAt.toISOString().replace(/[:.]/g, '-');
      const ext = extensionFor(row.mimeType);
      const file = `${stamp}_${row.cameraId}_${row.id.slice(0, 8)}${ext}`;
      writeFileSync(join(outDir, file), Buffer.from(row.data));
    }

    console.log(`Wrote ${rows.length} frame(s) to ${outDir}`);
    console.log(`npx ts-node scripts/try-detect.ts ${outDir}`);
  } finally {
    await app.close();
  }
}

void main();
