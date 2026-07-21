import { Zone } from '@prisma/client';
import { Point } from './geometry';
import { ZoneDto } from './dto/zone.dto';

export function toZoneDto(zone: Zone): ZoneDto {
  return {
    id: zone.id,
    cameraId: zone.cameraId,
    name: zone.name,
    enabled: zone.enabled,
    polygon: zone.polygon as unknown as Point[],
    geometryVersion: zone.geometryVersion,
    createdAt: zone.createdAt,
    updatedAt: zone.updatedAt,
  };
}
