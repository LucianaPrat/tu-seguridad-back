import { Injectable, Logger } from '@nestjs/common';
import { AlertEvent, EventDelivery } from '@prisma/client';
import { ErrorCode, EventHistory } from '../../cross/common/constants';
import { SecretTokenService } from '../../cross/crypto/secret-token.service';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { AlertEventAccessorService } from '../../data/accessors/alert-event.accessor';
import { AlertRoutingAccessorService } from '../../data/accessors/alert-routing.accessor';
import {
  EventDeliveryAccessorService,
  EventDeliveryDraft,
} from '../../data/accessors/event-delivery.accessor';
import {
  AlertRecipientRecord,
  SpaceMemberAccessorService,
} from '../../data/accessors/space-member.accessor';
import { AcknowledgementDto } from '../auth/dto/acknowledgement.dto';
import { AlertCandidate } from '../pipeline/alert-candidate';
import { AlertEmailService } from './alert-email.service';
import {
  decodeCursor,
  encodeCursor,
  toAlertEventDto,
  toEventDeliveryDto,
} from './alert-event.mapper';
import { AlertEventPageDto } from './dto/alert-event-page.dto';
import { AlertEventDto } from './dto/alert-event.dto';
import { EventDeliveryDto } from './dto/event-delivery.dto';
import { InboundAcknowledgementDto } from './dto/inbound-acknowledgement.dto';
import { QueryAlertEventsDto } from './dto/query-alert-events.dto';
import { EventAckTokenService } from './event-ack-token.service';
import { ALERT_EVENT_MESSAGE, EventsGateway } from './events.gateway';

/** What one event's fan-out produced, and who it was addressed to. */
interface PlannedDeliveries {
  deliveries: EventDelivery[];
  recipients: AlertRecipientRecord[];
}

@Injectable()
export class AlertEventsService {
  private readonly logger = new Logger(AlertEventsService.name);

  constructor(
    private readonly alertEventAccessor: AlertEventAccessorService,
    private readonly deliveryAccessor: EventDeliveryAccessorService,
    private readonly routingAccessor: AlertRoutingAccessorService,
    private readonly memberAccessor: SpaceMemberAccessorService,
    private readonly secretToken: SecretTokenService,
    private readonly gateway: EventsGateway,
    private readonly alertEmail: AlertEmailService,
    private readonly ackToken: EventAckTokenService,
  ) {}

  /**
   * Turns what the pipeline decided into history: one row per candidate, its
   * delivery attempts, and one broadcast to the space that owns it.
   *
   * The camera label and the alert type are copied into the event rather than
   * read back through the camera — that is the whole point of the columns, and
   * it is why deleting a camera later cannot rewrite what an operator saw.
   */
  async record(
    spaceId: string,
    candidates: AlertCandidate[],
  ): Promise<AlertEvent[]> {
    const events: AlertEvent[] = [];
    for (const candidate of candidates) {
      const event = await this.alertEventAccessor.create(spaceId, {
        cameraId: candidate.cameraId,
        zoneId: candidate.zoneId,
        cameraLabelSnapshot: candidate.cameraLabel,
        alertType: candidate.alertType,
        detectedAt: candidate.detectedAt,
        snapshotId: candidate.snapshotId,
        personsDetected: candidate.personsDetected,
        confidence: candidate.confidence,
      });
      if (!event) {
        this.logger.warn(
          `Discarded an alert for camera ${candidate.cameraId}: not in space ${spaceId}`,
        );
        continue;
      }

      const planned = await this.planDeliveries(spaceId, event);
      // `event` is the row from `create`, which carries no deliveries. Planning
      // already read the stored rows back, so the broadcast reports the real
      // channels instead of the empty list it had to send before that read
      // existed — no extra query, and the socket payload matches what
      // `GET /events/:id` answers for the same alert.
      this.gateway.broadcast(
        spaceId,
        ALERT_EVENT_MESSAGE,
        toAlertEventDto({ ...event, deliveries: planned.deliveries }),
      );
      // Not awaited: the socket broadcast is what the dashboard reacts to, and
      // an SMTP round trip per recipient would push it — and the next poll of
      // this camera — behind a relay this process does not control. `dispatch`
      // never rejects, so there is no unhandled rejection to leak here.
      void this.alertEmail.dispatch(
        event,
        planned.deliveries,
        planned.recipients,
      );
      events.push(event);
    }
    return events;
  }

  async query(
    spaceId: string,
    query: QueryAlertEventsDto,
  ): Promise<Either<AlertEventPageDto>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        'cursor is not a cursor this API issued',
      );
    }

    // One row past the page: its presence is what says another page exists,
    // without a second count over the highest-volume table in the schema.
    const take = query.limit ?? EventHistory.DEFAULT_PAGE_SIZE;
    const rows = await this.alertEventAccessor.query(spaceId, {
      alertType: query.alertType,
      from: query.from ? new Date(query.from) : undefined,
      take: take + 1,
      cursor: cursor ?? undefined,
    });

    const items = rows.slice(0, take);
    return buildData({
      items: items.map(toAlertEventDto),
      nextCursor:
        rows.length > take ? encodeCursor(items[items.length - 1]) : null,
    });
  }

  async findById(
    spaceId: string,
    eventId: string,
  ): Promise<Either<AlertEventDto>> {
    const event = await this.alertEventAccessor.findById(spaceId, eventId);
    if (!event) {
      return buildError(ErrorCode.NOT_FOUND, `Event ${eventId} not found`);
    }
    return buildData(toAlertEventDto(event));
  }

  async findDeliveries(
    spaceId: string,
    eventId: string,
  ): Promise<Either<EventDeliveryDto[]>> {
    const event = await this.alertEventAccessor.findById(spaceId, eventId);
    if (!event) {
      return buildError(ErrorCode.NOT_FOUND, `Event ${eventId} not found`);
    }
    const deliveries = await this.deliveryAccessor.findByEventId(
      spaceId,
      eventId,
    );
    return buildData(deliveries.map(toEventDeliveryDto));
  }

  /**
   * An acknowledgement from outside a session: a provider callback carrying the
   * delivery's `correlationId`, or a recipient following the acknowledge link of
   * an alert email, which carries a token derived from the delivery id.
   *
   * Every outcome answers the same `202`, whether the credential matched a
   * delivery, matched one already acknowledged, or matched nothing. The route is
   * unauthenticated — the credential is the whole authorization — so its answer
   * must reveal no event. A token that fails its MAC is therefore not an error
   * either: it is simply resolved to nothing.
   *
   * The only refused shape is a request that presents both credentials or
   * neither. That is a malformed call, not a failed one, and saying so leaks
   * nothing about any event.
   */
  async acknowledgeInbound(
    dto: InboundAcknowledgementDto,
  ): Promise<Either<AcknowledgementDto>> {
    if ((dto.correlationId === undefined) === (dto.token === undefined)) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        'Send exactly one of correlationId or token',
      );
    }

    const target = dto.correlationId
      ? { correlationId: dto.correlationId }
      : this.resolveAckToken(dto.token!);
    if (!target) {
      return buildData({ accepted: true });
    }

    const acknowledgement = await this.deliveryAccessor.consumeInbound(target);
    if (acknowledgement) {
      this.logger.log(
        `Event ${acknowledgement.eventId} acknowledged by user ${acknowledgement.acknowledgedByUserId}`,
      );
    }
    return buildData({ accepted: true });
  }

  private resolveAckToken(token: string): { id: string } | null {
    const deliveryId = this.ackToken.resolve(token);
    return deliveryId ? { id: deliveryId } : null;
  }

  /**
   * One delivery per enabled channel per opted-in active member, each with its
   * own correlation id: the id is what an inbound reply is resolved by, so two
   * recipients sharing one would make either of them the acknowledger.
   *
   * Rows are written `pending`. `AlertEmailService` moves the `email` ones;
   * `call` and `whatsapp` have no sender yet and stay as planned.
   *
   * The rows are read back rather than derived from the drafts because only the
   * stored row carries its id, and the accessor is allowed to drop a draft whose
   * recipient is not a member of the space.
   */
  private async planDeliveries(
    spaceId: string,
    event: AlertEvent,
  ): Promise<PlannedDeliveries> {
    const [routings, recipients] = await Promise.all([
      this.routingAccessor.findEnabled(spaceId, event.alertType),
      this.memberAccessor.findActiveRecipients(spaceId),
    ]);

    const drafts: EventDeliveryDraft[] = routings.flatMap((routing) =>
      recipients.map((recipient) => ({
        channel: routing.channel,
        recipientUserId: recipient.userId,
        correlationId: this.secretToken.generate(),
      })),
    );
    const created = await this.deliveryAccessor.createManyForEvent(
      spaceId,
      event.id,
      drafts,
    );
    if (created === 0) {
      return { deliveries: [], recipients };
    }

    return {
      deliveries: await this.deliveryAccessor.findByEventId(spaceId, event.id),
      recipients,
    };
  }
}
