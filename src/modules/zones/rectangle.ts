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
 * Boundary-inclusive, matching the polygon test it replaces: a person standing
 * exactly on the line the operator drew is inside it.
 */
export function containsPoint(rectangle: Rectangle, point: Point): boolean {
  return (
    point.x >= rectangle.x &&
    point.x <= rectangle.x + rectangle.width &&
    point.y >= rectangle.y &&
    point.y <= rectangle.y + rectangle.height
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
