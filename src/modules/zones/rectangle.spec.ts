import {
  boundsOf,
  containsPoint,
  containsPointInPolygon,
  FULL_FRAME,
  outlineOf,
  Point,
  Rectangle,
  toPercentPoint,
  validatePolygon,
  validateRectangle,
} from './rectangle';

describe('validateRectangle', () => {
  it('accepts a rectangle fully inside the frame', () => {
    const rectangle: Rectangle = { x: 10, y: 20, width: 30, height: 40 };

    expect(validateRectangle(rectangle)).toEqual([]);
  });

  it('accepts a rectangle exactly filling the frame', () => {
    const rectangle: Rectangle = { x: 0, y: 0, width: 100, height: 100 };

    expect(validateRectangle(rectangle)).toEqual([]);
  });

  it('rejects a negative x as origin-out-of-bounds', () => {
    const rectangle: Rectangle = { x: -5, y: 0, width: 10, height: 10 };

    expect(validateRectangle(rectangle).map((v) => v.rule)).toEqual([
      'origin-out-of-bounds',
    ]);
  });

  it('rejects a negative y as origin-out-of-bounds', () => {
    const rectangle: Rectangle = { x: 0, y: -5, width: 10, height: 10 };

    expect(validateRectangle(rectangle).map((v) => v.rule)).toEqual([
      'origin-out-of-bounds',
    ]);
  });

  it('rejects a zero width as empty-rectangle', () => {
    const rectangle: Rectangle = { x: 0, y: 0, width: 0, height: 10 };

    expect(validateRectangle(rectangle).map((v) => v.rule)).toEqual([
      'empty-rectangle',
    ]);
  });

  it('rejects a negative height as empty-rectangle', () => {
    const rectangle: Rectangle = { x: 0, y: 0, width: 10, height: -5 };

    expect(validateRectangle(rectangle).map((v) => v.rule)).toEqual([
      'empty-rectangle',
    ]);
  });

  it('rejects x + width exceeding the frame as exceeds-frame', () => {
    const rectangle: Rectangle = { x: 60, y: 0, width: 50, height: 10 };

    expect(validateRectangle(rectangle).map((v) => v.rule)).toEqual([
      'exceeds-frame',
    ]);
  });

  it('rejects y + height exceeding the frame as exceeds-frame', () => {
    const rectangle: Rectangle = { x: 0, y: 60, width: 10, height: 50 };

    expect(validateRectangle(rectangle).map((v) => v.rule)).toEqual([
      'exceeds-frame',
    ]);
  });
});

describe('containsPoint', () => {
  const rectangle: Rectangle = { x: 10, y: 10, width: 20, height: 20 };

  it('includes a point on an edge', () => {
    expect(containsPoint(rectangle, { x: 10, y: 15 })).toBe(true);
  });

  it('includes a point on a corner', () => {
    expect(containsPoint(rectangle, { x: 30, y: 30 })).toBe(true);
  });

  it('excludes a point just outside the rectangle', () => {
    expect(containsPoint(rectangle, { x: 9, y: 15 })).toBe(false);
  });
});

describe('toPercentPoint', () => {
  it('scales a [0,1] point to [0,100]', () => {
    expect(toPercentPoint({ x: 0.5, y: 0.25 })).toEqual({ x: 50, y: 25 });
  });

  it('scales the frame origin and far corner', () => {
    expect(toPercentPoint({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(toPercentPoint({ x: 1, y: 1 })).toEqual({ x: 100, y: 100 });
  });
});

describe('FULL_FRAME', () => {
  it('contains any in-frame point, including its own edges', () => {
    expect(containsPoint(FULL_FRAME, { x: 50, y: 50 })).toBe(true);
    expect(containsPoint(FULL_FRAME, { x: 0, y: 0 })).toBe(true);
    expect(containsPoint(FULL_FRAME, { x: 100, y: 100 })).toBe(true);
  });
});

/**
 * An L: the top-left quadrant is cut out of a 0..60 square, so the notch sits
 * inside the bounding box and outside the shape. That gap is the whole reason
 * the outline is stored next to the box.
 */
const L_SHAPE: Point[] = [
  { x: 30, y: 0 },
  { x: 60, y: 0 },
  { x: 60, y: 60 },
  { x: 0, y: 60 },
  { x: 0, y: 30 },
  { x: 30, y: 30 },
];

describe('containsPointInPolygon', () => {
  it('holds a point well inside the outline', () => {
    expect(containsPointInPolygon(L_SHAPE, { x: 45, y: 45 })).toBe(true);
  });

  it('excludes a point in the bounding box but outside the outline', () => {
    expect(containsPointInPolygon(L_SHAPE, { x: 10, y: 10 })).toBe(false);
  });

  it('counts a point sitting exactly on an edge as inside', () => {
    expect(containsPointInPolygon(L_SHAPE, { x: 15, y: 30 })).toBe(true);
  });

  it('counts a vertex as inside', () => {
    expect(containsPointInPolygon(L_SHAPE, { x: 0, y: 30 })).toBe(true);
  });

  it('excludes a point outside the bounding box', () => {
    expect(containsPointInPolygon(L_SHAPE, { x: 90, y: 90 })).toBe(false);
  });

  it('agrees with the rectangle test on a rectangular outline', () => {
    const rectangle: Rectangle = { x: 10, y: 10, width: 20, height: 20 };
    const outline = outlineOf(rectangle);

    expect(containsPointInPolygon(outline, { x: 20, y: 20 })).toBe(true);
    expect(containsPointInPolygon(outline, { x: 30, y: 30 })).toBe(true);
    expect(containsPointInPolygon(outline, { x: 31, y: 20 })).toBe(false);
  });
});

describe('containsPoint', () => {
  it('uses the outline when the area carries one', () => {
    const area = { ...boundsOf(L_SHAPE), points: L_SHAPE };

    expect(containsPoint(area, { x: 10, y: 10 })).toBe(false);
    expect(containsPoint(area, { x: 45, y: 45 })).toBe(true);
  });

  it('falls back to the bounding box when there is no outline', () => {
    expect(containsPoint(boundsOf(L_SHAPE), { x: 10, y: 10 })).toBe(true);
  });
});

describe('boundsOf', () => {
  it('wraps an outline in its tightest rectangle', () => {
    expect(boundsOf(L_SHAPE)).toEqual({ x: 0, y: 0, width: 60, height: 60 });
  });

  it('round-trips a rectangle through its outline', () => {
    const rectangle: Rectangle = { x: 5, y: 8, width: 20, height: 30 };

    expect(boundsOf(outlineOf(rectangle))).toEqual(rectangle);
  });
});

describe('validatePolygon', () => {
  it('accepts a triangle inside the frame', () => {
    expect(
      validatePolygon([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 100 },
      ]),
    ).toEqual([]);
  });

  it('rejects two points as outline-too-short', () => {
    expect(
      validatePolygon([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]).map((violation) => violation.rule),
    ).toEqual(['outline-too-short']);
  });

  it('rejects a point past the frame as outline-out-of-bounds', () => {
    expect(
      validatePolygon([
        { x: 0, y: 0 },
        { x: 101, y: 0 },
        { x: 50, y: 50 },
      ]).map((violation) => violation.rule),
    ).toEqual(['outline-out-of-bounds']);
  });

  it('rejects a negative coordinate as outline-out-of-bounds', () => {
    expect(
      validatePolygon([
        { x: 0, y: -1 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ]).map((violation) => violation.rule),
    ).toEqual(['outline-out-of-bounds']);
  });
});
