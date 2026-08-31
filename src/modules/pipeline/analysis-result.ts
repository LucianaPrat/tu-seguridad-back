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
  zoneResults: ZoneResult[];
  alerts: AlertCandidate[];
  /**
   * A zone of this camera is past `Outside` — an entry or an exit is still
   * unconfirmed. `occupied` says what this frame saw; this says whether the
   * hysteresis is done with it, which is what the poll cadence keys on.
   */
  occupancyPending: boolean;
}
