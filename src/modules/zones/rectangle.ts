import { ZoneGeometry } from '../../cross/common/constants';

export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What a zone covers. The rectangle is always the bounding box; `points` is the
 * free-hand outline the operator drew inside it, when they drew one. No
 * outline means the box is the shape, which is what every zone stored before
 * outlines existed is.
 */
export interface ZoneArea extends Rectangle {
  points?: Point[];
}

export interface RectangleViolation {
  rule: string;
  message: string;
}

/** A full-frame camera evaluates the whole image; same maths, one rectangle. */
export const FULL_FRAME: Rectangle = {
  x: ZoneGeometry.MIN_PERCENT,
  y: ZoneGeometry.MIN_PERCENT,
  width: ZoneGeometry.MAX_PERCENT,
  height: ZoneGeometry.MAX_PERCENT,
};

/**
 * The same rules `monitor_zones_rectangle_bounds_check` enforces in MySQL,
 * repeated here so the API answers with a message instead of a driver error.
 */
export function validateRectangle(rectangle: Rectangle): RectangleViolation[] {
  const violations: RectangleViolation[] = [];
  const { x, y, width, height } = rectangle;

  if (x < ZoneGeometry.MIN_PERCENT || y < ZoneGeometry.MIN_PERCENT) {
    violations.push({
      rule: 'origin-out-of-bounds',
      message: 'x and y must be at least 0',
    });
  }
  if (width <= 0 || height <= 0) {
    violations.push({
      rule: 'empty-rectangle',
      message: 'width and height must be greater than 0',
    });
  }
  if (
    x + width > ZoneGeometry.MAX_PERCENT ||
    y + height > ZoneGeometry.MAX_PERCENT
  ) {
    violations.push({
      rule: 'exceeds-frame',
      message: 'x + width and y + height must not exceed 100',
    });
  }

  return violations;
}

/**
 * The rules the outline has to satisfy before it can be stored. Point bounds
 * are checked here and not only in the DTO because the shape is a domain rule,
 * and the bounding box derived from an out-of-frame outline would look valid.
 */
export function validatePolygon(points: Point[]): RectangleViolation[] {
  const violations: RectangleViolation[] = [];

  if (points.length < ZoneGeometry.MIN_OUTLINE_POINTS) {
    violations.push({
      rule: 'outline-too-short',
      message: `points must hold at least ${ZoneGeometry.MIN_OUTLINE_POINTS} entries`,
    });
  }
  if (points.length > ZoneGeometry.MAX_OUTLINE_POINTS) {
    violations.push({
      rule: 'outline-too-long',
      message: `points must hold at most ${ZoneGeometry.MAX_OUTLINE_POINTS} entries`,
    });
  }
  if (
    points.some(
      (point) =>
        point.x < ZoneGeometry.MIN_PERCENT ||
        point.x > ZoneGeometry.MAX_PERCENT ||
        point.y < ZoneGeometry.MIN_PERCENT ||
        point.y > ZoneGeometry.MAX_PERCENT,
    )
  ) {
    violations.push({
      rule: 'outline-out-of-bounds',
      message: 'every point must sit between 0 and 100',
    });
  }

  return violations;
}

/** The tightest rectangle around an outline — what the columns store. */
export function boundsOf(points: Point[]): Rectangle {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

/** A rectangle read as an outline: its four corners, clockwise from top-left. */
export function outlineOf(rectangle: Rectangle): Point[] {
  const { x, y, width, height } = rectangle;
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

/**
 * Inside the zone: the outline when there is one, the bounding box otherwise.
 * Boundary-inclusive either way — a person standing exactly on the line the
 * operator drew is inside it.
 */
export function containsPoint(area: ZoneArea, point: Point): boolean {
  return area.points
    ? containsPointInPolygon(area.points, point)
    : containsPointInRectangle(area, point);
}

export function containsPointInRectangle(
  rectangle: Rectangle,
  point: Point,
): boolean {
  return (
    point.x >= rectangle.x &&
    point.x <= rectangle.x + rectangle.width &&
    point.y >= rectangle.y &&
    point.y <= rectangle.y + rectangle.height
  );
}

/**
 * Ray casting: walk the edges and count the ones a half-line drawn to the
 * right of the point crosses. Odd means inside. Edges are tested first and
 * separately, because ray casting decides a point sitting exactly on one by
 * accident of floating point, and here that decides whether an alert fires.
 */
export function containsPointInPolygon(points: Point[], point: Point): boolean {
  for (let i = 0; i < points.length; i += 1) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    if (isOnSegment(from, to, point)) {
      return true;
    }
  }

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (
      straddles &&
      point.x < a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x)
    ) {
      inside = !inside;
    }
  }

  return inside;
}

/** Percent coordinates carry two decimals, so the slack only absorbs float error. */
const ON_SEGMENT_EPSILON = 1e-9;

function isOnSegment(from: Point, to: Point, point: Point): boolean {
  const cross =
    (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
  if (Math.abs(cross) > ON_SEGMENT_EPSILON) {
    return false;
  }
  return (
    point.x >= Math.min(from.x, to.x) - ON_SEGMENT_EPSILON &&
    point.x <= Math.max(from.x, to.x) + ON_SEGMENT_EPSILON &&
    point.y >= Math.min(from.y, to.y) - ON_SEGMENT_EPSILON &&
    point.y <= Math.max(from.y, to.y) + ON_SEGMENT_EPSILON
  );
}

/**
 * Detection anchors arrive normalized to [0,1]; zones are percentages of the
 * frame. One conversion, at the boundary, so no comparison ever mixes them.
 */
export function toPercentPoint(point: Point): Point {
  return {
    x: point.x * ZoneGeometry.MAX_PERCENT,
    y: point.y * ZoneGeometry.MAX_PERCENT,
  };
}
