import { AlertType } from '@prisma/client';
import { PersonDetection } from '../face-auth-client/detect-persons-response';
import { AlertCandidate } from './alert-candidate';

export interface ZoneResult {
  /** `null` on a full-frame camera. */
  zoneId: string | null;
  alertType: AlertType;
  occupied: boolean;
}

export interface AnalysisResult {
  persons: PersonDetection[];
  /**
   * How many detections the upstream reported, before this camera's confidence
   * threshold dropped any. `persons` is what survived, so on its own it cannot
   * tell "the detector found nobody" from "it found somebody we refused" — and
   * those are different problems with different owners. The recall ledger keys
   * on the first of them.
   */
  personsReported: number;
  zoneResults: ZoneResult[];
  alerts: AlertCandidate[];
  /**
   * A zone of this camera is past `Outside` — an entry or an exit is still
   * unconfirmed. `occupied` says what this frame saw; this says whether the
   * hysteresis is done with it, which is what the poll cadence keys on.
   */
  occupancyPending: boolean;
}
