import { validatePolygon } from './geometry';

describe('validatePolygon', () => {
  it('accepts a valid square', () => {
    const violations = validatePolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);

    expect(violations).toEqual([]);
  });

  it('accepts a triangle touching the 0/1 boundaries', () => {
    const violations = validatePolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ]);

    expect(violations).toEqual([]);
  });

  it('rejects a bowtie (self-intersecting quadrilateral)', () => {
    const violations = validatePolygon([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);

    expect(violations.some((v) => v.rule === 'self-intersection')).toBe(true);
  });

  it('rejects a polygon with area 1e-6 (below the minimum)', () => {
    const violations = validatePolygon([
      { x: 0, y: 0 },
      { x: 0.002, y: 0 },
      { x: 0, y: 0.001 },
    ]);

    expect(violations).toEqual([expect.objectContaining({ rule: 'min-area' })]);
  });

  it('rejects fewer than 3 points', () => {
    const violations = validatePolygon([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);

    expect(violations).toEqual([
      expect.objectContaining({ rule: 'min-vertices' }),
    ]);
  });

  it('rejects consecutive duplicate vertices', () => {
    const violations = validatePolygon([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);

    expect(
      violations.some((v) => v.rule === 'duplicate-vertex' && v.index === 0),
    ).toBe(true);
  });

  it('rejects a coordinate of 1.001 (out of the [0,1] range)', () => {
    const violations = validatePolygon([
      { x: 0, y: 0 },
      { x: 1.001, y: 0 },
      { x: 0.5, y: 1 },
    ]);

    expect(
      violations.some((v) => v.rule === 'out-of-bounds' && v.index === 1),
    ).toBe(true);
  });

  it('accepts a concave L-shape', () => {
    const violations = validatePolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 0, y: 1 },
    ]);

    expect(violations).toEqual([]);
  });

  it('rejects collinear points as degenerate (zero area)', () => {
    const violations = validatePolygon([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
    ]);

    expect(violations).toEqual([expect.objectContaining({ rule: 'min-area' })]);
  });

  it('flags a non-adjacent edge endpoint touching another edge as self-intersecting', () => {
    const violations = validatePolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0 },
      { x: 0, y: 1 },
    ]);

    expect(violations.some((v) => v.rule === 'self-intersection')).toBe(true);
  });
});
