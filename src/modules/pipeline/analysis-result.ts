import { PersonDetection } from '../face-auth-client/detect-persons-response';
import { ZoneEventDto } from '../events/dto/zone-event.dto';

export interface ZoneResult {
  zoneId: string;
  occupied: boolean;
}

export interface AnalysisResult {
  persons: PersonDetection[];
  zoneResults: ZoneResult[];
  eventsEmitted: ZoneEventDto[];
}
