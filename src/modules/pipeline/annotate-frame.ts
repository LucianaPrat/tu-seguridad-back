import sharp from 'sharp';
import { CapturedImage } from '../dvr/dvr-client.port';
import { PersonDetection } from '../face-auth-client/detect-persons-response';
import { describeImage } from '../snapshots/snapshot.service';

/**
 * Burns the upstream's own boxes into the evidence frame.
 *
 * Why into the pixels and not over them: the frame travels as a `cid:`
 * attachment in the alert email, and an absolutely positioned overlay is the
 * first thing a mail client drops — silently, which is the failure mode the
 * template already refuses everywhere else. A box that only renders in Gmail is
 * worse than no box, because nobody finds out. Burning it in also means the
 * dashboard's `GET /snapshots/:id` shows the same annotated frame the recipient
 * saw, with no second code path to keep in step.
 *
 * `bboxNorm` is used rather than `bbox`: it is already relative to the frame,
 * so nothing depends on the upstream having reported the same pixel dimensions
 * the encoder actually produced.
 *
 * ponytail: the raw frame is not kept — the annotated one replaces it. Store
 * both when someone needs the untouched pixels as evidence.
 */

/** Loud enough to find on a grey night frame, and not a colour the scene produces. */
const BOX_COLOUR = '#12FF5C';
const LABEL_INK = '#04210D';

/** Re-encode quality. High enough that the frame is still evidence, low enough
 * that the annotated bytes stay near the original and clear `SNAPSHOT_MAX_BYTES`. */
const JPEG_QUALITY = 88;

const MIN_STROKE = 2;
const MIN_FONT = 12;

/**
 * Most boxes drawn on one frame, highest `detScore` first. A frame with more
 * detections than this is a crowd or a misbehaving model, and either way the
 * annotation stops being readable long before the ceiling — it also keeps the
 * SVG the upstream's response size can grow bounded, since the size check in
 * `SnapshotService.store` only runs on the finished buffer.
 */
const MAX_BOXES = 12;

interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
}

/**
 * Returns a new `CapturedImage` carrying the annotated bytes, or the original
 * image untouched when there is nothing to draw or the bytes cannot be decoded.
 * It never throws: a frame that failed to annotate must still be stored, and an
 * alert must never be lost to a drawing step.
 */
export async function annotateDetections(
  image: CapturedImage,
  persons: PersonDetection[],
): Promise<CapturedImage> {
  if (persons.length === 0) {
    return image;
  }
  try {
    const { width, height } = await sharp(image.data).metadata();
    if (!width || !height) {
      return image;
    }
    const boxes = [...persons]
      .sort((left, right) => right.detScore - left.detScore)
      .slice(0, MAX_BOXES)
      .map((person) => toPixelBox(person, width, height))
      .filter((box): box is PixelBox => box !== null);
    if (boxes.length === 0) {
      return image;
    }
    const annotated = await sharp(image.data)
      .composite([
        {
          input: Buffer.from(buildOverlay(width, height, boxes)),
          top: 0,
          left: 0,
        },
      ])
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return describeImage(annotated, 'image/jpeg', image.capturedAt);
  } catch {
    return image;
  }
}

/**
 * One detection as pixels inside the frame. Coordinates are clamped rather than
 * trusted — a box the upstream reported slightly outside the frame would
 * otherwise place the overlay off-canvas and lose the whole composite.
 */
function toPixelBox(
  person: PersonDetection,
  width: number,
  height: number,
): PixelBox | null {
  const { topLeft, bottomRight } = person.bboxNorm;
  const left = clampToFrame(topLeft.x) * width;
  const top = clampToFrame(topLeft.y) * height;
  const right = clampToFrame(bottomRight.x) * width;
  const bottom = clampToFrame(bottomRight.y) * height;
  if (right <= left || bottom <= top) {
    return null;
  }
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
    label: `${Math.round(person.detScore * 100)}%`,
  };
}

function clampToFrame(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * The overlay is sized in fractions of the frame, so a 640px snapshot and a
 * 4K one both get a stroke you can see and a label you can read.
 *
 * The confidence sits on a filled tag rather than as bare text: the frame
 * underneath is arbitrary, and green-on-grey at 3am is not readable. The tag
 * also degrades honestly on a host with no fonts installed — the reader sees a
 * marker instead of nothing.
 */
function buildOverlay(
  width: number,
  height: number,
  boxes: PixelBox[],
): string {
  const stroke = Math.max(MIN_STROKE, Math.round(width / 320));
  const fontSize = Math.max(MIN_FONT, Math.round(width / 48));
  const padding = Math.round(fontSize * 0.35);
  const tagHeight = fontSize + padding * 2;

  const shapes = boxes
    .map((box) => {
      const tagWidth =
        Math.round(box.label.length * fontSize * 0.62) + padding * 2;
      // Above the box when there is room, tucked inside its top edge otherwise.
      const tagTop =
        box.top >= tagHeight + stroke ? box.top - tagHeight : box.top;
      const tagLeft = Math.min(box.left, Math.max(0, width - tagWidth));
      return [
        `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="none" stroke="${BOX_COLOUR}" stroke-width="${stroke}" />`,
        `<rect x="${tagLeft}" y="${tagTop}" width="${tagWidth}" height="${tagHeight}" fill="${BOX_COLOUR}" />`,
        `<text x="${tagLeft + padding}" y="${tagTop + fontSize + padding * 0.6}" font-family="sans-serif" font-size="${fontSize}" font-weight="bold" fill="${LABEL_INK}">${box.label}</text>`,
      ].join('');
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes}</svg>`;
}
