import { Injectable } from '@nestjs/common';
import {
  AlertChannel,
  EventDelivery,
  EventDeliveryStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** One planned attempt: a channel, who it goes to, and its callback token. */
export interface EventDeliveryDraft {
  channel: AlertChannel;
  recipientUserId: number;
  correlationId: string;
}

/** A delivery the retry sweep picked up, with the event it belongs to. */
export type RetryableDelivery = Prisma.EventDeliveryGetPayload<{
  include: { event: true };
}>;

/** What an inbound provider callback resolved to, once and only once. */
export interface InboundAcknowledgement {
  deliveryId: string;
  eventId: string;
  acknowledgedByUserId: number;
}

/**
 * The statuses a send may still move away from. `delivered` and `sent` are
 * terminal, and writing over either would lose an acknowledgement or claim a
 * second send of one message.
 */
const RETRYABLE_STATUSES = [
  EventDeliveryStatus.pending,
  EventDeliveryStatus.failed,
];

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
   * Records a sent attempt, and counts it.
   *
   * Guarded rather than written blind: an inbound acknowledgement can land
   * before the send call returns, and that callback already set the row
   * `delivered` — overwriting it with `sent` would lose the acknowledgement the
   * operator actually made. `failed` is in the guard because a retry starts
   * from there; `delivered` and `sent` never are.
   */
  async markSent(
    deliveryId: string,
    providerMessageId: string | null,
    now = new Date(),
  ): Promise<boolean> {
    const updated = await this.prisma.eventDelivery.updateMany({
      where: { id: deliveryId, status: { in: RETRYABLE_STATUSES } },
      data: {
        status: EventDeliveryStatus.sent,
        sentAt: now,
        providerMessageId,
        attempts: { increment: 1 },
      },
    });
    return updated.count === 1;
  }

  /**
   * Same `pending` guard, same reason. `error` is what went wrong, never a
   * credential.
   *
   * `sentAt` stays null: nothing was sent. When the attempt was made is
   * `updatedAt`, and a failed row carrying a send time would read to the history
   * screen as a message that went out.
   */
  async markFailed(deliveryId: string, error: string): Promise<boolean> {
    const updated = await this.prisma.eventDelivery.updateMany({
      where: { id: deliveryId, status: { in: RETRYABLE_STATUSES } },
      data: {
        status: EventDeliveryStatus.failed,
        error,
        attempts: { increment: 1 },
      },
    });
    return updated.count === 1;
  }

  /**
   * Deliveries the retry sweep should try again.
   *
   * `email` only, and that filter is what keeps `call` and `whatsapp` out: their
   * rows are `pending` because nobody ever built a sender, and picking them up
   * would spin on them forever. No column distinguishes "pending because the
   * send did not finish" from "pending because no sender exists" — the channel
   * already does, so no migration was needed for it.
   *
   * `pending` as well as `failed`: a crash between planning the row and
   * finishing the send leaves it `pending` with nothing else coming for it.
   *
   * `attempts` caps how long a relay that will never accept the message costs
   * anything, and `updatedAt` is the delay — a row touched moments ago is still
   * in flight.
   */
  findRetryable(
    before: Date,
    maxAttempts: number,
    limit: number,
  ): Promise<RetryableDelivery[]> {
    return this.prisma.eventDelivery.findMany({
      where: {
        channel: AlertChannel.email,
        status: { in: RETRYABLE_STATUSES },
        attempts: { lt: maxAttempts },
        updatedAt: { lt: before },
      },
      include: { event: true },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Claims one inbound acknowledgement and acknowledges its event in the same
   * transaction. Split in two, a failure between them records a reply the
   * history never shows as acknowledged.
   *
   * `inboundReceivedAt: null` is what makes it idempotent: the second callback
   * for the same delivery updates nothing and gets `null` back, which is also
   * what an unknown one gets — the caller cannot tell them apart, and no
   * unauthenticated route should be able to.
   *
   * The delivery is addressed by whichever unique column the caller holds: a
   * provider webhook has the `correlationId`, and the emailed acknowledge link
   * resolves to an `id`. One implementation because the claim, the ordering and
   * the first-responder rule are identical either way — the difference is only
   * which credential proved the caller may act.
   */
  consumeInbound(
    target: { correlationId: string } | { id: string },
    now = new Date(),
  ): Promise<InboundAcknowledgement | null> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.eventDelivery.updateMany({
        where: { ...target, inboundReceivedAt: null },
        data: {
          inboundReceivedAt: now,
          deliveredAt: now,
          status: EventDeliveryStatus.delivered,
        },
      });
      if (claimed.count !== 1) {
        return null;
      }

      const delivery = await tx.eventDelivery.findUnique({ where: target });
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
