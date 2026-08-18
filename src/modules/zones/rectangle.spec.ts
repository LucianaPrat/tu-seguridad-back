import {
  containsPoint,
  FULL_FRAME,
  Rectangle,
  toPercentPoint,
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
