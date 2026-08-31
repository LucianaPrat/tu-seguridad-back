import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AlertChannel,
  AlertEvent,
  AlertType,
  EventDelivery,
  EventDeliveryStatus,
} from '@prisma/client';
import { EnvNames } from '../../cross/common/constants';
import { MailerService } from '../../cross/mail/mailer.service';
import { EventDeliveryAccessorService } from '../../data/accessors/event-delivery.accessor';
import { AlertRecipientRecord } from '../../data/accessors/space-member.accessor';

/**
 * What each alert type is called in a subject line. Read from the event's own
 * copied `alertType`, so a routing change later never renames an old mail.
 */
const ALERT_SUBJECT: Record<AlertType, string> = {
  intruder: 'Intruder alert',
  suspicious: 'Suspicious activity',
};

/**
 * Where the alert lands in the frontend. Same standing as `CREDENTIAL_MAIL` in
 * `smtp-credential-delivery.service.ts`: this repo's assumption about the
 * client's routes, and the single place to correct when the real one exists.
 */
const EVENT_PATH = '/events';

/** What `EventDelivery.error` keeps of a relay's complaint. The log keeps it all. */
const STORED_ERROR_MAX_LENGTH = 500;

/**
 * The camera label and the member's name are operator-supplied text, and the
 * HTML part of the mail is the one place they stop being data. A label of
 * `<a href="...">` would otherwise render as a link the recipient can click.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The email channel of the alert fan-out. `AlertEventsService` plans the
 * delivery rows; this is what actually moves the `email` ones off `pending`.
 *
 * Two things it deliberately never puts in a message: the delivery
 * `correlationId`, which is the credential the inbound acknowledgement route
 * accepts and must not leave the process, and the snapshot bytes — the frame is
 * served by `GET /snapshots/:id` to an authenticated caller, and a mailbox is
 * not one.
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
  ) {
    this.enabled = configService.get<boolean>(EnvNames.MAIL_ENABLED) === true;
    this.appBaseUrl = configService.get<string>(EnvNames.APP_BASE_URL)!;
  }

  /**
   * Sends the `email` deliveries planned for one event and records what
   * happened to each. Rows for the other channels are left `pending` — they
   * have no sender yet, and marking them anything else would claim an attempt
   * nobody made.
   *
   * ponytail: serial, no retry, no queue. A relay that rejects one message
   * fails that one row and the loop continues; a process restart mid-fan-out
   * leaves the rest `pending` forever. Add a worker that drains `pending` when
   * a missed alert stops being acceptable.
   */
  async dispatch(
    event: AlertEvent,
    deliveries: EventDelivery[],
    recipients: AlertRecipientRecord[],
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.debug(
        `MAIL_ENABLED is off; ${deliveries.length} planned deliveries for event ${event.id} stay pending`,
      );
      return;
    }

    for (const delivery of deliveries) {
      if (
        delivery.channel !== AlertChannel.email ||
        delivery.status !== EventDeliveryStatus.pending
      ) {
        continue;
      }
      await this.sendOne(
        event,
        delivery,
        recipients.find(
          (recipient) => recipient.userId === delivery.recipientUserId,
        ),
      );
    }
  }

  private async sendOne(
    event: AlertEvent,
    delivery: EventDelivery,
    recipient: AlertRecipientRecord | undefined,
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

      const sent = await this.mailer.send(
        this.buildMail(event, recipient.user.email, recipient.user.firstName),
      );
      await this.deliveryAccessor.markSent(delivery.id, sent.messageId ?? null);
      this.logger.log({
        msg: 'alert email sent',
        eventId: event.id,
        deliveryId: delivery.id,
        recipientUserId: delivery.recipientUserId,
        messageId: sent.messageId,
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

  private buildMail(event: AlertEvent, to: string, firstName: string) {
    const headline = `${ALERT_SUBJECT[event.alertType]} — ${event.cameraLabelSnapshot}`;
    const detectedAt = event.detectedAt.toISOString();
    const persons =
      event.personsDetected === null
        ? 'not recorded'
        : String(event.personsDetected);
    // Concatenated for the same reason as the credential link: a leading-slash
    // path resolved against a base would drop any subpath the frontend is
    // mounted under.
    const link = `${this.appBaseUrl.replace(/\/+$/, '')}${EVENT_PATH}/${event.id}`;

    return {
      to,
      subject: headline,
      text: [
        `Hi ${firstName},`,
        '',
        headline,
        '',
        `Camera: ${event.cameraLabelSnapshot}`,
        `Detected at: ${detectedAt}`,
        `People in frame: ${persons}`,
        '',
        `Open the alert: ${link}`,
      ].join('\n'),
      html: [
        `<p>Hi ${escapeHtml(firstName)},</p>`,
        `<p><strong>${escapeHtml(headline)}</strong></p>`,
        `<p>Camera: ${escapeHtml(event.cameraLabelSnapshot)}<br>Detected at: ${detectedAt}<br>People in frame: ${persons}</p>`,
        `<p><a href="${link}">Open the alert</a></p>`,
      ].join(''),
    };
  }
}
