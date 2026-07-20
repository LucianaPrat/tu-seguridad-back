import { ZoneEvent } from '@prisma/client';
import { ZoneEventDto } from './dto/zone-event.dto';

export function toZoneEventDto(event: ZoneEvent): ZoneEventDto {
  return {
    id: event.id,
    eventId: event.eventId,
    eventType: event.eventType,
    cameraId: event.cameraId,
    zoneId: event.zoneId,
    occurredAt: event.occurredAt,
    confidence: event.confidence,
    personsInZone: event.personsInZone,
    anchor: event.anchor as unknown as { x: number; y: number } | null,
  };
}
