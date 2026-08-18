import { AlertCandidate } from './alert-candidate';

/**
 * Where a raised alert goes. The pipeline decides *that* an alert happened and
 * at which level; persisting it, broadcasting it and routing it to channels
 * belong to the alert-event domain, which owns the implementation bound here.
 */
export abstract class AlertEmitterPort {
  abstract emit(spaceId: string, candidate: AlertCandidate): Promise<void>;
}
