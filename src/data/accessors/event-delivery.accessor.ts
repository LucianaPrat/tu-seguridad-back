import { Injectable } from '@nestjs/common';
import {
  AlertChannel,
  EventDelivery,
  EventDeliveryStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** One planned attempt: a channel, who it goes to, and its callback token. */
export interface EventDeliveryDraft {
  channel: AlertChannel;
  recipientUserId: number;
  correlationId: string;
}

/** What an inbound provider callback resolved to, once and only once. */
export interface InboundAcknowledgement {
  deliveryId: string;
  eventId: string;
  acknowledgedByUserId: number;
}

@Injectable()
export class EventDeliveryAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fans one event out over its routing matrix. The event's space and every
   * recipient's membership are checked here rather than trusted from the
   * caller: this is the row that carries the correlation id, and a delivery
   * addressed outside the space would hand that token to the wrong account.
   */
  async createManyForEvent(
    spaceId: string,
    eventId: string,
    drafts: EventDeliveryDraft[],
  ): Promise<number> {
    if (drafts.length === 0) {
      return 0;
    }

    const event = await this.prisma.alertEvent.findFirst({
      where: { id: eventId, spaceId },
      select: { id: true },
    });
    if (!event) {
      return 0;
    }

    const members = await this.prisma.spaceMember.findMany({
      where: {
        spaceId,
        userId: { in: drafts.map((draft) => draft.recipientUserId) },
      },
      select: { userId: true },
    });
    const memberIds = new Set(members.map((member) => member.userId));
    const rows = drafts
      .filter((draft) => memberIds.has(draft.recipientUserId))
      .map((draft) => ({ ...draft, eventId }));
    if (rows.length === 0) {
      return 0;
    }

    const created = await this.prisma.eventDelivery.createMany({ data: rows });
    return created.count;
  }

  findByEventId(spaceId: string, eventId: string): Promise<EventDelivery[]> {
    return this.prisma.eventDelivery.findMany({
      where: { eventId, event: { spaceId } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Claims one inbound provider callback and acknowledges its event in the same
   * transaction. Split in two, a failure between them records a reply the
   * history never shows as acknowledged.
   *
   * `inboundReceivedAt: null` is what makes it idempotent: the second callback
   * for the same correlation id updates nothing and gets `null` back, which is
   * also what an unknown id gets — the caller cannot tell them apart, and no
   * unauthenticated route should be able to.
   */
  consumeInbound(
    correlationId: string,
    now = new Date(),
  ): Promise<InboundAcknowledgement | null> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.eventDelivery.updateMany({
        where: { correlationId, inboundReceivedAt: null },
        data: {
          inboundReceivedAt: now,
          deliveredAt: now,
          status: EventDeliveryStatus.delivered,
        },
      });
      if (claimed.count !== 1) {
        return null;
      }

      const delivery = await tx.eventDelivery.findUnique({
        where: { correlationId },
      });
      if (!delivery) {
        return null;
      }

      // First responder wins: a later reply on another channel records its own
      // delivery but does not rewrite who acknowledged the alert.
      await tx.alertEvent.updateMany({
        where: { id: delivery.eventId, acknowledgedAt: null },
        data: {
          acknowledgedAt: now,
          acknowledgedByUserId: delivery.recipientUserId,
        },
      });

      return {
        deliveryId: delivery.id,
        eventId: delivery.eventId,
        acknowledgedByUserId: delivery.recipientUserId,
      };
    });
  }
}
