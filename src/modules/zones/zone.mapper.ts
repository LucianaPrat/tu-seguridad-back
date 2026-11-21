import { MonitorZone } from '@prisma/client';
import { MonitorZoneDto } from './dto/zone.dto';
import { outlineOf, Point, Rectangle, ZoneArea } from './rectangle';

/**
 * `DECIMAL(5,2)` comes back as a Prisma `Decimal`, which serializes as a string
 * and would reach the UI as `"12.50"`. The conversion happens once, here.
 */
export function toRectangle(zone: MonitorZone): Rectangle {
  return {
    x: Number(zone.x),
    y: Number(zone.y),
    width: Number(zone.width),
    height: Number(zone.height),
  };
}

/**
 * `points` is a JSON column, so its contents are whatever was written there.
 * Anything that is not a list of numeric pairs is read as no outline at all
 * rather than trusted into the geometry, where a `NaN` would silently decide
 * that nobody is ever inside the zone.
 */
export function toOutline(value: MonitorZone['points']): Point[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const points = value.filter(
    (entry): entry is { x: number; y: number } =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { x?: unknown }).x === 'number' &&
      typeof (entry as { y?: unknown }).y === 'number',
  );
  return points.length === value.length
    ? points.map((point) => ({ x: point.x, y: point.y }))
    : undefined;
}

export function toZoneArea(zone: MonitorZone): ZoneArea {
  return { ...toRectangle(zone), points: toOutline(zone.points) };
}

export function toMonitorZoneDto(zone: MonitorZone): MonitorZoneDto {
  const rectangle = toRectangle(zone);
  return {
    id: zone.id,
    cameraId: zone.cameraId,
    ...rectangle,
    // One shape for every client: a zone stored before outlines existed, or
    // drawn with the rectangle tool, answers the corners of its rectangle.
    points: toOutline(zone.points) ?? outlineOf(rectangle),
    alertType: zone.alertType,
    createdAt: zone.createdAt,
    updatedAt: zone.updatedAt,
  };
}
