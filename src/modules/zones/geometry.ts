export interface Point {
  x: number;
  y: number;
}

export interface PolygonViolation {
  rule: string;
  message: string;
  index?: number;
}

const EPSILON = 1e-9;
export const MIN_ZONE_AREA = 0.0001;

export function validatePolygon(points: Point[]): PolygonViolation[] {
  const violations: PolygonViolation[] = [];

  if (!points || points.length < 3) {
    violations.push({
      rule: 'min-vertices',
      message: 'Polygon must have at least 3 vertices',
    });
    return violations;
  }

  points.forEach((point, index) => {
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      violations.push({
        rule: 'out-of-bounds',
        message: `Vertex ${index} (${point.x}, ${point.y}) is outside the [0,1] normalized range`,
        index,
      });
    }
  });

  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON) {
      violations.push({
        rule: 'duplicate-vertex',
        message: `Vertex ${i} duplicates the next vertex`,
        index: i,
      });
    }
  }

  const area = shoelaceArea(points);
  if (area < MIN_ZONE_AREA) {
    violations.push({
      rule: 'min-area',
      message: `Polygon area ${area} is below the minimum ${MIN_ZONE_AREA}`,
    });
  }

  if (hasSelfIntersection(points)) {
    violations.push({
      rule: 'self-intersection',
      message: 'Polygon edges self-intersect',
    });
  }

  return violations;
}

function shoelaceArea(points: Point[]): number {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function edgesAreAdjacent(i: number, j: number, n: number): boolean {
  return j === (i + 1) % n || i === (j + 1) % n;
}

function hasSelfIntersection(points: Point[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (edgesAreAdjacent(i, j, n)) {
        continue;
      }
      const a1 = points[i];
      const a2 = points[(i + 1) % n];
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

function orientation(p: Point, q: Point, r: Point): number {
  const value = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(value) < EPSILON) {
    return 0;
  }
  return value > 0 ? 1 : 2;
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    q.x <= Math.max(p.x, r.x) + EPSILON &&
    q.x >= Math.min(p.x, r.x) - EPSILON &&
    q.y <= Math.max(p.y, r.y) + EPSILON &&
    q.y >= Math.min(p.y, r.y) - EPSILON
  );
}

function segmentsIntersect(
  p1: Point,
  q1: Point,
  p2: Point,
  q2: Point,
): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}
