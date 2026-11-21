import { AlertType } from '@prisma/client';

/** Same sentinel the occupancy engine uses for a full-frame camera. */
const FULL_FRAME_KEY = 'full';

/**
 * Suppresses a repeat alert for the same area of the same camera inside a
 * window.
 *
 * The occupancy hysteresis already collapses a flickering detection into one
 * cycle, which is the frame-level protection. This is the event-level one: a
 * person who stays in a zone, leaves the frame for a single poll and comes
 * back exits and re-enters, and at the detection cadence that is a mail every
 * couple of minutes. The recipient stops reading them, which is the actual
 * failure this prevents.
 *
 * Per `(camera, zone, alert type)` rather than per camera, because a different
 * alert type on the same zone is new information — an `intruder` after a
 * `suspicious` is exactly what nobody wants suppressed.
 *
 * ponytail: in-memory window, lost on restart, so a restart inside a window
 * costs at most one duplicate alert. A column if a restart storm ever matters.
 */
export class AlertCooldown {
  private readonly armedUntil = new Map<string, number>();

  /** `0` disables suppression entirely, the pre-cooldown behaviour. */
  constructor(private readonly windowSeconds: number) {}

  /**
   * Answers whether this candidate becomes an alert, and arms the window when
   * it does. One call, because "is it allowed" and "remember that it was" must
   * not be able to drift apart.
   */
  admit(
    cameraId: string,
    zoneId: string | null,
    alertType: AlertType,
    now: number,
  ): boolean {
    if (this.windowSeconds === 0) {
      return true;
    }

    const key = this.key(cameraId, zoneId, alertType);
    const until = this.armedUntil.get(key);
    if (until !== undefined && until > now) {
      return false;
    }

    this.armedUntil.set(key, now + this.windowSeconds * 1000);
    return true;
  }

  /** Clears every window for a camera (zone edit, disable or delete). */
  reset(cameraId: string): void {
    const prefix = `${cameraId} `;
    for (const key of this.armedUntil.keys()) {
      if (key.startsWith(prefix)) {
        this.armedUntil.delete(key);
      }
    }
  }

  private key(
    cameraId: string,
    zoneId: string | null,
    alertType: AlertType,
  ): string {
    return `${cameraId} ${zoneId ?? FULL_FRAME_KEY} ${alertType}`;
  }
}
