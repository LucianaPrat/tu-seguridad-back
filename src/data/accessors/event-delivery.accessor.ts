import { Injectable } from '@nestjs/common';
import { EventDelivery, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateEventDeliveryInput extends Omit<
  Prisma.EventDeliveryUncheckedCreateInput,
  'eventId'
> {
  eventId: string;
}

@Injectable()
export class EventDeliveryAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    spaceId: string,
    data: CreateEventDeliveryInput,
  ): Promise<EventDelivery | null> {
    const [event, recipient] = await Promise.all([
      this.prisma.alertEvent.findFirst({
        where: { id: data.eventId, spaceId },
        select: { id: true },
      }),
      this.prisma.spaceMember.findFirst({
        where: { spaceId, userId: data.recipientUserId },
        select: { userId: true },
      }),
    ]);
    if (!event || !recipient) {
      return null;
    }
    return this.prisma.eventDelivery.create({ data });
  }

  findByEventId(spaceId: string, eventId: string): Promise<EventDelivery[]> {
    return this.prisma.eventDelivery.findMany({
      where: { eventId, event: { spaceId } },
      orderBy: { createdAt: 'asc' },
    });
  }

  findByCorrelationId(correlationId: string): Promise<EventDelivery | null> {
    return this.prisma.eventDelivery.findUnique({ where: { correlationId } });
  }

  async recordInboundReceipt(
    correlationId: string,
    now = new Date(),
  ): Promise<EventDelivery | null> {
    const result = await this.prisma.eventDelivery.updateMany({
      where: { correlationId, inboundReceivedAt: null },
      data: { inboundReceivedAt: now, deliveredAt: now, status: 'delivered' },
    });
    if (result.count !== 1) {
      return null;
    }
    return this.prisma.eventDelivery.findUnique({ where: { correlationId } });
  }
}
