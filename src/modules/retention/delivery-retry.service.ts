import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvNames } from '../../cross/common/constants';
import {
  EventDeliveryAccessorService,
  RetryableDelivery,
} from '../../data/accessors/event-delivery.accessor';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { AlertEmailService } from '../events/alert-email.service';

/**
 * Rows picked up per run. A constant rather than a variable: it bounds one
 * sweep, the sweep runs every five minutes, and there is no deployment where
 * the right answer is different enough to be worth an env var.
 */
const BATCH_SIZE = 50;

/**
 * Second attempts at alert emails the first pass did not deliver.
 *
 * `AlertEmailService.dispatch` is called without being awaited, deliberately —
 * a relay outage must not stall detection. The cost was that a relay hiccup
 * left the row `failed` and nothing ever tried again, and a crash between
 * planning the row and finishing the send left it `pending` forever, which was
 * indistinguishable from the `call` and `whatsapp` rows that are `pending`
 * because nobody ever built a sender.
 *
 * The `event_deliveries` row is the queue. It has a status, a timestamp, an
 * error and now an attempt count, which is every field a queue would have kept
 * — and BullMQ was declined for this project on cost, so a table that already
 * exists is the answer rather than an infrastructure dependency that does not.
 */
@Injectable()
export class DeliveryRetryService {
  private readonly logger = new Logger(DeliveryRetryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly deliveryAccessor: EventDeliveryAccessorService,
    private readonly spaceMemberAccessor: SpaceMemberAccessorService,
    private readonly alertEmail: AlertEmailService,
  ) {}

  /**
   * Every five minutes rather than nightly: an alert nobody was told about is
   * worth less the longer it waits, and the batch is small.
   *
   * Public so a spec can drive it and an operator can rehearse it.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'delivery-retry' })
  async sweep(): Promise<void> {
    if (!this.configService.get<boolean>(EnvNames.DELIVERY_RETRY_ENABLED)) {
      return;
    }

    const delaySeconds = this.configService.getOrThrow<number>(
      EnvNames.DELIVERY_RETRY_DELAY_SECONDS,
    );
    const maxAttempts = this.configService.getOrThrow<number>(
      EnvNames.DELIVERY_RETRY_MAX_ATTEMPTS,
    );
    const before = new Date(Date.now() - delaySeconds * 1000);

    let stuck: RetryableDelivery[];
    try {
      stuck = await this.deliveryAccessor.findRetryable(
        before,
        maxAttempts,
        BATCH_SIZE,
      );
    } catch (error) {
      this.logger.error(
        'could not read the deliveries to retry',
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }
    if (stuck.length === 0) {
      return;
    }

    // Grouped by event because everything the send needs beyond the row itself
    // — the frame, the recorder time zone, the space's recipients — is per
    // event, and two rows for one alert would otherwise load all of it twice.
    const byEvent = new Map<string, RetryableDelivery[]>();
    for (const delivery of stuck) {
      const group = byEvent.get(delivery.eventId);
      if (group) {
        group.push(delivery);
      } else {
        byEvent.set(delivery.eventId, [delivery]);
      }
    }

    this.logger.log(
      `retrying ${stuck.length} alert deliveries across ${byEvent.size} events`,
    );

    for (const group of byEvent.values()) {
      await this.retryEvent(group);
    }
  }

  /**
   * One event's stuck rows. A failure here is logged and the next event still
   * runs: the groups are independent, and one unreachable space is no reason to
   * leave every other alert unsent.
   */
  private async retryEvent(deliveries: RetryableDelivery[]): Promise<void> {
    const event = deliveries[0].event;
    try {
      const recipients = await this.spaceMemberAccessor.findActiveRecipients(
        event.spaceId,
      );
      await this.alertEmail.resend(event, deliveries, recipients);
    } catch (error) {
      this.logger.error(
        `retrying deliveries for event ${event.id} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
