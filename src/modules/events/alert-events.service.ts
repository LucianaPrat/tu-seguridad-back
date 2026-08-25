import { Injectable, Logger } from '@nestjs/common';
import { AlertEvent } from '@prisma/client';
import { ErrorCode, EventHistory } from '../../cross/common/constants';
import { SecretTokenService } from '../../cross/crypto/secret-token.service';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { AlertEventAccessorService } from '../../data/accessors/alert-event.accessor';
import { AlertRoutingAccessorService } from '../../data/accessors/alert-routing.accessor';
import {
  EventDeliveryAccessorService,
  EventDeliveryDraft,
} from '../../data/accessors/event-delivery.accessor';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { AcknowledgementDto } from '../auth/dto/acknowledgement.dto';
import { AlertCandidate } from '../pipeline/alert-candidate';
import {
  decodeCursor,
  encodeCursor,
  toAlertEventDto,
  toEventDeliveryDto,
} from './alert-event.mapper';
import { AlertEventPageDto } from './dto/alert-event-page.dto';
import { AlertEventDto } from './dto/alert-event.dto';
import { EventDeliveryDto } from './dto/event-delivery.dto';
import { QueryAlertEventsDto } from './dto/query-alert-events.dto';
import { ALERT_EVENT_MESSAGE, EventsGateway } from './events.gateway';

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

      await this.planDeliveries(spaceId, event);
      this.gateway.broadcast(
        spaceId,
        ALERT_EVENT_MESSAGE,
        toAlertEventDto(event),
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
   * A provider callback, answered identically whether the correlation id
   * matched a delivery, matched one that was already acknowledged, or matched
   * nothing at all. The route is unauthenticated until a webhook
   * authentication scheme is chosen, so its answer must reveal no event.
   */
  async acknowledgeInbound(
    correlationId: string,
  ): Promise<Either<AcknowledgementDto>> {
    const acknowledgement =
      await this.deliveryAccessor.consumeInbound(correlationId);
    if (acknowledgement) {
      this.logger.log(
        `Event ${acknowledgement.eventId} acknowledged by user ${acknowledgement.acknowledgedByUserId}`,
      );
    }
    return buildData({ accepted: true });
  }

  /**
   * One delivery per enabled channel per opted-in active member, each with its
   * own correlation id: the id is what an inbound reply is resolved by, so two
   * recipients sharing one would make either of them the acknowledger.
   *
   * Rows are written `pending`. Nothing sends them yet — see the tracker.
   */
  private async planDeliveries(
    spaceId: string,
    event: AlertEvent,
  ): Promise<number> {
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
    return this.deliveryAccessor.createManyForEvent(spaceId, event.id, drafts);
  }
}
