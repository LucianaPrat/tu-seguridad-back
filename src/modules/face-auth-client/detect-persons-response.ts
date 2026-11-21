export interface Coordinate {
  x: number;
  y: number;
}

export interface BoundingBox {
  topLeft: Coordinate;
  bottomRight: Coordinate;
}

export interface PersonDetection {
  detScore: number;
  bbox: BoundingBox;
  bboxNorm: BoundingBox;
  anchor: Coordinate;
}

export interface DetectPersonsResponse {
  personsDetected: boolean;
  imageWidth: number;
  imageHeight: number;
  persons: PersonDetection[];
}

/**
 * The type parameter on the request is the only thing asserting this shape, so a
 * renamed field arrives as `undefined` and reaches `toPercentPoint` as `NaN`: the
 * rectangle test then answers `false` for every anchor and the camera stops
 * alerting without logging anything. Only the two fields the pipeline reads are
 * checked — `bbox` and `bboxNorm` are carried through and never consumed.
 */
export function isDetectPersonsResponse(
  value: unknown,
): value is DetectPersonsResponse {
  const body = value as DetectPersonsResponse | undefined;
  return (
    Array.isArray(body?.persons) &&
    body.persons.every(
      (person) =>
        typeof person?.detScore === 'number' &&
        typeof person?.anchor?.x === 'number' &&
        typeof person?.anchor?.y === 'number',
    )
  );
}
