import sharp from 'sharp';
import { CapturedImage } from '../dvr/dvr-client.port';
import { PersonDetection } from '../face-auth-client/detect-persons-response';
import { describeImage } from '../snapshots/snapshot.service';
import { annotateDetections } from './annotate-frame';

const WIDTH = 640;
const HEIGHT = 360;

/** A flat dark-grey frame: nothing in it is green, so any green pixel is drawn. */
async function greyFrame(): Promise<CapturedImage> {
  const data = await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: { r: 60, g: 60, b: 60 },
    },
  })
    .jpeg()
    .toBuffer();
  return describeImage(data, 'image/jpeg', new Date('2026-08-31T20:39:46Z'));
}

function person(detScore = 0.84): PersonDetection {
  const box = {
    topLeft: { x: 0.3, y: 0.25 },
    bottomRight: { x: 0.55, y: 0.9 },
  };
  return {
    detScore,
    bbox: {
      topLeft: { x: 192, y: 90 },
      bottomRight: { x: 352, y: 324 },
    },
    bboxNorm: box,
    anchor: { x: 0.425, y: 0.9 },
  };
}

/** How much of the frame is close to the box colour, as a fraction of all pixels. */
async function greenShare(data: Buffer): Promise<number> {
  const { data: pixels, info } = await sharp(data)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let green = 0;
  for (let index = 0; index < pixels.length; index += info.channels) {
    const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
    if (g > 170 && r < 140 && b < 150) {
      green += 1;
    }
  }
  return green / (info.width * info.height);
}

describe('annotateDetections', () => {
  it('draws the box and the confidence tag onto the frame', async () => {
    const frame = await greyFrame();

    const annotated = await annotateDetections(frame, [person()]);

    expect(annotated.data).not.toEqual(frame.data);
    expect(annotated.mimeType).toBe('image/jpeg');
    expect(annotated.byteSize).toBe(annotated.data.byteLength);
    expect(annotated.capturedAt).toEqual(frame.capturedAt);
    // The frame it replaces is described afresh, so the digest must move too.
    expect(annotated.sha256).not.toBe(frame.sha256);

    const { width, height } = await sharp(annotated.data).metadata();
    expect({ width, height }).toEqual({ width: WIDTH, height: HEIGHT });
    expect(await greenShare(frame.data)).toBe(0);
    expect(await greenShare(annotated.data)).toBeGreaterThan(0.002);
  });

  it('draws one box per detection', async () => {
    const frame = await greyFrame();
    const second: PersonDetection = {
      ...person(0.51),
      bboxNorm: {
        topLeft: { x: 0.6, y: 0.3 },
        bottomRight: { x: 0.85, y: 0.85 },
      },
    };

    const one = await annotateDetections(frame, [person()]);
    const two = await annotateDetections(frame, [person(), second]);

    expect(await greenShare(two.data)).toBeGreaterThan(
      await greenShare(one.data),
    );
  });

  it('draws the strongest detections only, and no more than the ceiling', async () => {
    const frame = await greyFrame();
    // 40 stacked thin boxes: without a cap they would cover most of the frame.
    const crowd: PersonDetection[] = Array.from({ length: 40 }, (_, index) => ({
      ...person(0.5 + index / 100),
      bboxNorm: {
        topLeft: { x: 0.02, y: index / 45 },
        bottomRight: { x: 0.98, y: index / 45 + 0.02 },
      },
    }));

    const annotated = await annotateDetections(frame, crowd);
    const twelve = await annotateDetections(frame, crowd.slice(-12));

    // The twelve highest scores are the tail of the array, and they are the
    // only ones drawn — so the crowd frame and that slice annotate identically.
    expect(await greenShare(annotated.data)).toBeCloseTo(
      await greenShare(twelve.data),
      3,
    );
  });

  it('returns the frame untouched when there is nothing to draw', async () => {
    const frame = await greyFrame();

    expect(await annotateDetections(frame, [])).toBe(frame);
  });

  it('returns the frame untouched when a box is degenerate or off-frame', async () => {
    const frame = await greyFrame();
    const collapsed: PersonDetection = {
      ...person(),
      bboxNorm: {
        topLeft: { x: 0.4, y: 0.4 },
        bottomRight: { x: 0.4, y: 0.4 },
      },
    };

    expect(await annotateDetections(frame, [collapsed])).toBe(frame);
  });

  it('returns the frame untouched when the bytes cannot be decoded', async () => {
    // An alert must never be lost because the drawing step could not read the
    // frame — the pipeline stores whatever came back from here.
    const broken = describeImage(Buffer.from('not an image'), 'image/jpeg');

    expect(await annotateDetections(broken, [person()])).toBe(broken);
  });
});
