import { Injectable, Logger } from '@nestjs/common';
import { AlertCandidate } from './alert-candidate';
import { AlertEmitterPort } from './alert-emitter.port';

/**
 * Placeholder implementation: it records that an alert was raised and drops it.
 *
 * It exists so the detection pipeline can ship and be tested before the alert
 * event, routing and delivery domain does. It logs ids and the alert level
 * only — never the label, which is operator-supplied text, and never image
 * bytes. Replaced by the persisting emitter, not extended.
 */
@Injectable()
export class LoggedAlertEmitterService extends AlertEmitterPort {
  private readonly logger = new Logger(LoggedAlertEmitterService.name);

  emit(spaceId: string, candidate: AlertCandidate): Promise<void> {
    this.logger.warn(
      `alert raised (not yet persisted): space=${spaceId} camera=${candidate.cameraId} ` +
        `zone=${candidate.zoneId ?? 'full-frame'} type=${candidate.alertType} ` +
        `snapshot=${candidate.snapshotId ?? 'none'}`,
    );
    return Promise.resolve();
  }
}
