import { Injectable } from '@nestjs/common';
import { AlertEvent, AlertType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Where the previous page stopped, as the tuple the history index is ordered
 * by. `id` is not decoration: one detection frame writes an event per entered
 * area with the identical `detectedAt`, so a timestamp-only cursor would skip
 * or repeat the siblings.
 */
export interface AlertEventCursor {
  detectedAt: Date;
  id: string;
}

export interface AlertEventQuery {
  alertType?: AlertType;
  /** Inclusive lower bound; the UI filters history forward from a date. */
  from?: Date;
  take: number;
  cursor?: AlertEventCursor;
}

export type CreateAlertEventInput = Omit<
  Prisma.AlertEventUncheckedCreateInput,
  'spaceId'
>;

@Injectable()
export class AlertEventAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    spaceId: string,
    data: CreateAlertEventInput,
  ): Promise<AlertEvent | null> {
    const [camera, zone, snapshot] = await Promise.all([
      data.cameraId
        ? this.prisma.camera.findFirst({
            where: { id: data.cameraId, dvr: { spaceId } },
            select: { id: true },
          })
        : Promise.resolve(null),
      data.zoneId
        ? this.prisma.monitorZone.findFirst({
            where: { id: data.zoneId, camera: { dvr: { spaceId } } },
            select: { id: true },
          })
        : Promise.resolve(null),
      data.snapshotId
        ? this.prisma.snapshot.findFirst({
            where: { id: data.snapshotId, camera: { dvr: { spaceId } } },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (
      (data.cameraId && !camera) ||
      (data.zoneId && !zone) ||
      (data.snapshotId && !snapshot)
    ) {
      return null;
    }
    return this.prisma.alertEvent.create({ data: { ...data, spaceId } });
  }

  findById(spaceId: string, eventId: string): Promise<AlertEvent | null> {
    return this.prisma.alertEvent.findFirst({
      where: { id: eventId, spaceId },
    });
  }

  /**
   * One page of history, newest first, over the
   * `(space_id, detected_at DESC)` and `(space_id, alert_type, detected_at DESC)`
   * indexes. Keyset rather than `skip`: the table is the highest-volume one in
   * the schema, and an offset both scans what it discards and shifts under a
   * reader while new alerts arrive at the head.
   */
  query(spaceId: string, query: AlertEventQuery): Promise<AlertEvent[]> {
    const where: Prisma.AlertEventWhereInput = { spaceId };
    if (query.alertType) {
      where.alertType = query.alertType;
    }
    if (query.from) {
      where.detectedAt = { gte: query.from };
    }
    if (query.cursor) {
      // Prisma has no row-value comparison, so the tuple predicate is spelled
      // out: strictly older, or the same instant with a lower id.
      where.OR = [
        { detectedAt: { lt: query.cursor.detectedAt } },
        { detectedAt: query.cursor.detectedAt, id: { lt: query.cursor.id } },
      ];
    }
    return this.prisma.alertEvent.findMany({
      where,
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: query.take,
    });
  }
}
