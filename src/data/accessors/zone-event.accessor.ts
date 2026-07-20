import { Injectable } from '@nestjs/common';
import { Prisma, ZoneEvent, ZoneEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ZoneEventQueryFilter {
  cameraId?: string;
  zoneId?: string;
  eventType?: ZoneEventType;
  from?: Date; // occurredAt >= from
  to?: Date; // occurredAt <= to
  limit?: number; // already validated/clamped by the caller — this accessor just applies `take`, it does NOT clamp
}

@Injectable()
export class ZoneEventAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ZoneEventUncheckedCreateInput): Promise<ZoneEvent> {
    return this.prisma.zoneEvent.create({ data });
  }

  findByEventId(eventId: string): Promise<ZoneEvent | null> {
    return this.prisma.zoneEvent.findUnique({ where: { eventId } });
  }

  query(filter: ZoneEventQueryFilter): Promise<ZoneEvent[]> {
    const where: Prisma.ZoneEventWhereInput = {};
    if (filter.cameraId) where.cameraId = filter.cameraId;
    if (filter.zoneId) where.zoneId = filter.zoneId;
    if (filter.eventType) where.eventType = filter.eventType;
    if (filter.from || filter.to) {
      where.occurredAt = {};
      if (filter.from) where.occurredAt.gte = filter.from;
      if (filter.to) where.occurredAt.lte = filter.to;
    }
    return this.prisma.zoneEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      ...(filter.limit !== undefined ? { take: filter.limit } : {}),
    });
  }
}
