import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AlertChannel,
  AlertEvent,
  EventDelivery,
  EventDeliveryStatus,
} from '@prisma/client';
import { EnvNames } from '../../cross/common/constants';
import {
  MailerService,
  OutboundAttachment,
} from '../../cross/mail/mailer.service';
import { DvrAccessorService } from '../../data/accessors/dvr.accessor';
import { EventDeliveryAccessorService } from '../../data/accessors/event-delivery.accessor';
import { SnapshotAccessorService } from '../../data/accessors/snapshot.accessor';
import { AlertRecipientRecord } from '../../data/accessors/space-member.accessor';
import { buildAlertMail } from './alert-email.template';
import { EventAckTokenService } from './event-ack-token.service';

/**
 * Where the alert lands in the frontend. Same standing as `CREDENTIAL_MAIL` in
 * `smtp-credential-delivery.service.ts`: this repo's assumption about the
 * client's routes, and the single place to correct when the real ones exist.
 *
 * The acknowledge link points at the frontend, not at this API, for the same
 * reason every credential link does — a token in a URL this process serves
 * would be written to its own access log on every click.
 */
const EVENT_PATH = '/events';
const ACKNOWLEDGE_PATH = 'acknowledge';

/** What `EventDelivery.error` keeps of a relay's complaint. The log keeps it all. */
const STORED_ERROR_MAX_LENGTH = 500;

/** Content id of the inline frame. Local to one message, so a constant is enough. */
const SNAPSHOT_CID = 'alert-frame';

/** The recorder's own time zone is unknown when a space has no DVR configured. */
const FALLBACK_TIMEZONE = 'UTC';

interface InlineFrame {
  attachment: OutboundAttachment;
  cid: string;
}

/**
 * The email channel of the alert fan-out. `AlertEventsService` plans the
 * delivery rows; this is what actually moves the `email` ones off `pending`.
 *
 * What it never puts in a message: the delivery `correlationId`. That is the
 * credential the provider webhook accepts, it is on `SENSITIVE_FIELD_NAMES`,
 * and mailing it would hand a working acknowledgement to whoever reads the
 * mailbox. The acknowledge link carries a token derived per delivery instead —
 * see `EventAckTokenService`.
 *
 * What it does put in a message, deliberately: the snapshot bytes, inline. The
 * frame is the whole point of the notice, and a link to `GET /snapshots/:id`
 * shows a logged-out recipient nothing. The narrowing of that rule is recorded
 * in `AGENTS.md`.
 *
 * Nothing here throws. The pipeline calls it without awaiting, so a rejection
 * would surface as an unhandled one and a relay outage would look like a bug in
 * detection.
 */
@Injectable()
export class AlertEmailService {
  private readonly logger = new Logger(AlertEmailService.name);
  private readonly enabled: boolean;
  private readonly appBaseUrl: string;

  constructor(
    configService: ConfigService,
    private readonly mailer: MailerService,
    private readonly deliveryAccessor: EventDeliveryAccessorService,
    private readonly snapshotAccessor: SnapshotAccessorService,
    private readonly dvrAccessor: DvrAccessorService,
    private readonly ackToken: EventAckTokenService,
  ) {
    this.enabled = configService.get<boolean>(EnvNames.MAIL_ENABLED) === true;
    this.appBaseUrl = (
      configService.get<string>(EnvNames.APP_BASE_URL) ?? ''
    ).replace(/\/+$/, '');
  }

  /**
   * Sends the `email` deliveries planned for one event and records what
   * happened to each. Rows for the other channels are left `pending` — they
   * have no sender yet, and marking them anything else would claim an attempt
   * nobody made.
   *
   * The frame and the time zone are read once per event, not once per
   * recipient: every message about one alert shows the same picture.
   *
   * Serial, and still the first attempt only: a relay that rejects one message
   * fails that one row and the loop continues. What picks the failure back up
   * is `DeliveryRetryService`, which calls `resend` below.
   */
  dispatch(
    event: AlertEvent,
    deliveries: EventDelivery[],
    recipients: AlertRecipientRecord[],
  ): Promise<void> {
    return this.send(
      event,
      deliveries.filter(
        (delivery) => delivery.status === EventDeliveryStatus.pending,
      ),
      recipients,
    );
  }

  /**
   * A second attempt at rows the first pass left behind — `failed`, or
   * `pending` because a restart interrupted the fan-out. Same send, same
   * recording; the only difference from `dispatch` is that the row's current
   * status is not what decides whether to try.
   */
  resend(
    event: AlertEvent,
    deliveries: EventDelivery[],
    recipients: AlertRecipientRecord[],
  ): Promise<void> {
    return this.send(event, deliveries, recipients);
  }

  private async send(
    event: AlertEvent,
    deliveries: EventDelivery[],
    recipients: AlertRecipientRecord[],
  ): Promise<void> {
    const outgoing = deliveries.filter(
      (delivery) => delivery.channel === AlertChannel.email,
    );
    if (outgoing.length === 0) {
      return;
    }
    if (!this.enabled) {
      this.logger.debug(
        `MAIL_ENABLED is off; ${outgoing.length} email deliveries for event ${event.id} stay pending`,
      );
      return;
    }

    const [frame, timezone] = await Promise.all([
      this.loadFrame(event),
      this.loadTimezone(event.spaceId),
    ]);

    for (const delivery of outgoing) {
      await this.sendOne(
        event,
        delivery,
        recipients.find(
          (recipient) => recipient.userId === delivery.recipientUserId,
        ),
        frame,
        timezone,
      );
    }
  }

  private async sendOne(
    event: AlertEvent,
    delivery: EventDelivery,
    recipient: AlertRecipientRecord | undefined,
    frame: InlineFrame | null,
    timezone: string,
  ): Promise<void> {
    try {
      if (!recipient) {
        // The delivery row outlived the membership that justified it. Recorded
        // as a failure rather than dropped: the history screen must be able to
        // say the alert reached nobody on this channel.
        await this.deliveryAccessor.markFailed(
          delivery.id,
          'recipient is no longer an alert recipient of this space',
        );
        return;
      }

      const mail = buildAlertMail({
        alertType: event.alertType,
        cameraLabel: event.cameraLabelSnapshot,
        detectedAt: event.detectedAt,
        timezone,
        personsDetected: event.personsDetected,
        // Prisma hands `Decimal(4,3)` back as its own type; the template wants
        // the plain 0..1 number it formats as a percent.
        confidence: event.confidence === null ? null : Number(event.confidence),
        recipientFirstName: recipient.user.firstName,
        eventUrl: `${this.appBaseUrl}${EVENT_PATH}/${event.id}`,
        acknowledgeUrl: this.acknowledgeUrl(event.id, delivery.id),
        snapshotCid: frame?.cid ?? null,
      });

      const sent = await this.mailer.send({
        to: recipient.user.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: frame ? [frame.attachment] : undefined,
      });
      await this.deliveryAccessor.markSent(delivery.id, sent.messageId ?? null);
      this.logger.log({
        msg: 'alert email sent',
        eventId: event.id,
        deliveryId: delivery.id,
        recipientUserId: delivery.recipientUserId,
        messageId: sent.messageId,
        withFrame: frame !== null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // `EventDelivery.error` is served by `GET /events/:id/deliveries`, so what
      // a relay chose to say lands in an API response. Capped rather than
      // trusted: the column is TEXT, and the useful part of an SMTP rejection is
      // always its first line.
      const reason = message.slice(0, STORED_ERROR_MAX_LENGTH);
      this.logger.error({
        msg: 'alert email failed',
        eventId: event.id,
        deliveryId: delivery.id,
        recipientUserId: delivery.recipientUserId,
        reason: message,
      });
      // Best effort: if the database is what broke, the row stays `pending`,
      // which is the honest state — nothing was sent and nothing was recorded.
      await this.deliveryAccessor
        .markFailed(delivery.id, reason)
        .catch(() => undefined);
    }
  }

  /**
   * The frontend route that turns the emailed token into an acknowledgement.
   * The event id is in the path so the page can send the reader on to the alert
   * afterwards without a second lookup.
   */
  private acknowledgeUrl(eventId: string, deliveryId: string): string {
    const url = new URL(
      `${this.appBaseUrl}${EVENT_PATH}/${eventId}/${ACKNOWLEDGE_PATH}`,
    );
    url.searchParams.set('token', this.ackToken.issue(deliveryId));
    return url.href;
  }

  /**
   * The stored frame, as an inline attachment. A missing snapshot is normal —
   * an alert can be raised on a frame that failed to store — so the mail is
   * built without it rather than not sent.
   */
  private async loadFrame(event: AlertEvent): Promise<InlineFrame | null> {
    if (!event.snapshotId) {
      return null;
    }
    try {
      const snapshot = await this.snapshotAccessor.findForAlertEvent(
        event.spaceId,
        event.snapshotId,
      );
      if (!snapshot) {
        return null;
      }
      return {
        cid: SNAPSHOT_CID,
        attachment: {
          filename: `alert-${event.id}.jpg`,
          content: Buffer.from(snapshot.data),
          contentType: snapshot.mimeType,
          cid: SNAPSHOT_CID,
        },
      };
    } catch (error) {
      // A frame that cannot be read must not cost the notification itself.
      this.logger.warn({
        msg: 'alert email frame unavailable',
        eventId: event.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async loadTimezone(spaceId: string): Promise<string> {
    try {
      const dvr = await this.dvrAccessor.findBySpaceId(spaceId);
      return dvr?.timezone ?? FALLBACK_TIMEZONE;
    } catch {
      return FALLBACK_TIMEZONE;
    }
  }
}
