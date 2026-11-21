import { AlertType } from '@prisma/client';

/**
 * What the detection pipeline decided, before anything is persisted or sent.
 *
 * `cameraLabel` travels with the candidate rather than being looked up later:
 * the alert history stores the label as it read at detection time, so renaming
 * a camera cannot rewrite what an operator was told.
 */
export interface AlertCandidate {
  cameraId: string;
  cameraLabel: string;
  /** `null` when the camera monitors the full frame. */
  zoneId: string | null;
  alertType: AlertType;
  detectedAt: Date;
  /** Stored frame the alert was raised on, when one could be written. */
  snapshotId: string | null;
  personsDetected: number;
  confidence: number | null;
}
