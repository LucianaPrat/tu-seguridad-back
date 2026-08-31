import { AlertEvent, EventDelivery } from '@prisma/client';
import {
  AlertEventCursor,
  AlertEventWithChannels,
} from '../../data/accessors/alert-event.accessor';
import { snapshotUrl } from '../snapshots/snapshot.mapper';
import { AlertEventDto } from './dto/alert-event.dto';
import { EventDeliveryDto } from './dto/event-delivery.dto';

const CURSOR_SEPARATOR = '|';

export function toAlertEventDto(event: AlertEventWithChannels): AlertEventDto {
  return {
    id: event.id,
    cameraId: event.cameraId,
    zoneId: event.zoneId,
    cameraLabel: event.cameraLabelSnapshot,
    alertType: event.alertType,
    detectedAt: event.detectedAt,
    snapshotUrl: event.snapshotId ? snapshotUrl(event.snapshotId) : null,
    personsDetected: event.personsDetected,
    // `DECIMAL` comes back as a Prisma `Decimal`, which serializes as a string
    // — the same conversion the zone rectangle needs, see `zone.mapper.ts`.
    confidence: event.confidence === null ? null : Number(event.confidence),
    acknowledgedAt: event.acknowledgedAt,
    acknowledgedByUserId: event.acknowledgedByUserId,
    channels: [
      ...new Set(event.deliveries.map((delivery) => delivery.channel)),
    ],
  };
}

export function toEventDeliveryDto(delivery: EventDelivery): EventDeliveryDto {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    channel: delivery.channel,
    recipientUserId: delivery.recipientUserId,
    status: delivery.status,
    sentAt: delivery.sentAt,
    deliveredAt: delivery.deliveredAt,
    inboundReceivedAt: delivery.inboundReceivedAt,
    error: delivery.error,
    createdAt: delivery.createdAt,
  };
}

/**
 * The paging cursor is the ordering tuple, base64url so it survives a query
 * string. Opaque on purpose: it encodes where the reader stopped, and a client
 * that parsed it would be coupled to the sort order.
 */
export function encodeCursor(event: AlertEvent): string {
  return Buffer.from(
    `${event.detectedAt.toISOString()}${CURSOR_SEPARATOR}${event.id}`,
  ).toString('base64url');
}

/** `null` for anything that is not a cursor this API produced. */
export function decodeCursor(value: string): AlertEventCursor | null {
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  const separator = decoded.indexOf(CURSOR_SEPARATOR);
  if (separator < 0) {
    return null;
  }

  const detectedAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(detectedAt.getTime()) || id.length === 0) {
    return null;
  }
  return { detectedAt, id };
}
