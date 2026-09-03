import { NestFactory } from '@nestjs/core';
import { readdirSync, readFileSync, statSync } from 'fs';
import { basename, extname, join } from 'path';
import { AppModule } from '../src/app.module';
import { FaceAuthClientService } from '../src/modules/face-auth-client/face-auth-client.service';

/**
 * What the upstream detector answers, for one frame or for a directory of them.
 *
 * Booted through Nest on purpose: it goes out over the real
 * `FaceAuthClientService`, so the session-token exchange, the circuit breaker
 * and the throttle park are the ones production uses. The numbers it prints are
 * the raw `persons[]` — no confidence filter, which lives in `PipelineService`
 * — so a run measures the detector and nothing else.
 *
 * This is the tool that answers "did the reframe help": recall is only a
 * measurement, and plans/05.detection-quality.md is a plan of measurements.
 */

/**
 * Floor between detect calls. The upstream is IP-throttled and undocumented:
 * measured on 2026-09-02, 250 ms spacing drew a `429` after ~17 requests and
 * then a penalty window of 15–45 s, while 12 s ran clean. Five is the floor
 * this script will not go under whatever the caller asks for.
 */
const MIN_GAP_MS = 5000;
const DEFAULT_GAP_MS = 12000;

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** One row per frame, tab separated so it pastes into a spreadsheet as is. */
interface Row {
  file: string;
  persons: number;
  scores: number[];
  error?: string;
}

function framesIn(target: string): string[] {
  if (!statSync(target).isDirectory()) {
    return [target];
  }
  return readdirSync(target)
    .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort()
    .map((name) => join(target, name));
}

function summarise(rows: Row[]): void {
  const answered = rows.filter((row) => !row.error);
  const withPersons = answered.filter((row) => row.persons > 0);
  const scores = answered.flatMap((row) => row.scores);
  const percent = answered.length
    ? Math.round((withPersons.length / answered.length) * 100)
    : 0;

  console.log('');
  console.log(`frames answered   ${answered.length}/${rows.length}`);
  console.log(
    `with a detection  ${withPersons.length}/${answered.length} (${percent}%)`,
  );
  if (scores.length > 0) {
    const sorted = [...scores].sort((left, right) => left - right);
    console.log(
      `detScore range    ${sorted[0].toFixed(3)} – ${sorted[sorted.length - 1].toFixed(3)}`,
    );
  }
  const failed = rows.filter((row) => row.error);
  if (failed.length > 0) {
    console.log(`upstream failures ${failed.length}`);
  }
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error(
      'Usage: npx ts-node scripts/try-detect.ts <image.jpg | directory> [gapMs]',
    );
    process.exit(1);
  }
  const gapMs = Math.max(MIN_GAP_MS, Number(process.argv[3]) || DEFAULT_GAP_MS);

  const frames = framesIn(target);
  if (frames.length === 0) {
    console.error(`No .jpg, .jpeg or .png files in ${target}`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const client = app.get(FaceAuthClientService);
    const rows: Row[] = [];
    console.log('file\tpersons\tscores');

    for (const [index, path] of frames.entries()) {
      const result = await client.detectPersons(
        readFileSync(path),
        basename(path),
      );
      const row: Row = result.ok
        ? {
            file: basename(path),
            persons: result.data.persons.length,
            scores: result.data.persons
              .map((person) => person.detScore)
              .sort((left, right) => right - left),
          }
        : {
            file: basename(path),
            persons: 0,
            scores: [],
            error: `${result.code}: ${result.message}`,
          };
      rows.push(row);
      console.log(
        [
          row.file,
          row.error ? `ERR ${row.error}` : row.persons,
          row.scores.map((score) => score.toFixed(3)).join(',') || '-',
        ].join('\t'),
      );

      // Not after the last frame: a single-image run must stay as quick as it
      // was before this script grew a batch mode.
      if (index < frames.length - 1) {
        await sleep(gapMs);
      }
    }

    if (rows.length > 1) {
      summarise(rows);
    }
    process.exitCode = rows.some((row) => row.error) ? 1 : 0;
  } finally {
    await app.close();
  }
}

void main();
