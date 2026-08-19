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
}
