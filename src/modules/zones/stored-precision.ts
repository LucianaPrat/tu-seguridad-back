import { ZoneGeometry } from '../../cross/common/constants';

/**
 * A percentage arrives from a pixel drag divided by the frame size, so its
 * precision is whatever that division produced. The columns are DECIMAL(5,2):
 * round here, before validation, so the shape checked is the shape stored —
 * rounding after the frame-bounds check could push `x + width` past 100 and
 * turn a valid request into a driver error.
 */
export function toStoredPrecision({ value }: { value: unknown }): unknown {
  return typeof value === 'number'
    ? Number(value.toFixed(ZoneGeometry.DECIMAL_PLACES))
    : value;
}
