import { MonitorZone } from '@prisma/client';
import { MonitorZoneDto } from './dto/zone.dto';
import { Rectangle } from './rectangle';

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

export function toMonitorZoneDto(zone: MonitorZone): MonitorZoneDto {
  return {
    id: zone.id,
    cameraId: zone.cameraId,
    ...toRectangle(zone),
    alertType: zone.alertType,
    createdAt: zone.createdAt,
    updatedAt: zone.updatedAt,
  };
}
