import { ZoneEventType } from '@prisma/client';
import { PipelineDefaults } from '../../cross/common/constants';
import { Point, pointInPolygon } from '../zones/geometry';

type OccupancyStateName =
  'Outside' | 'CandidateInside' | 'Inside' | 'CandidateOutside';

interface ZoneOccupancyState {
  state: OccupancyStateName;
  consecutiveCount: number;
}

export interface ZoneInput {
  zoneId: string;
  enabled: boolean;
  polygon: Point[];
}

export interface AnchorWithScore {
  anchor: Point;
  detScore: number;
}

export interface OccupancyTransition {
  zoneId: string;
  eventType: ZoneEventType;
  confidence: number | null;
  personsInZone: number;
  anchor: Point | null;
}

const OUTSIDE: ZoneOccupancyState = { state: 'Outside', consecutiveCount: 0 };
const INSIDE: ZoneOccupancyState = { state: 'Inside', consecutiveCount: 0 };

/**
 * Per (cameraId, zoneId) occupancy state machine with hysteresis
 * (architecture README §10.1/§10.2). Pure domain logic: no I/O.
 */
export class OccupancyEngine {
  private readonly states = new Map<string, ZoneOccupancyState>();

  constructor(
    private readonly enterConsecutivePolls: number = PipelineDefaults.ENTER_CONSECUTIVE_POLLS,
    private readonly exitConsecutivePolls: number = PipelineDefaults.EXIT_CONSECUTIVE_POLLS,
  ) {}

  evaluate(
    cameraId: string,
    zones: ZoneInput[],
    anchors: AnchorWithScore[],
  ): OccupancyTransition[] {
    const transitions: OccupancyTransition[] = [];

    for (const zone of zones) {
      if (!zone.enabled) {
        continue;
      }

      const key = this.key(cameraId, zone.zoneId);
      const current = this.states.get(key) ?? OUTSIDE;
      const anchorsInside = anchors.filter((a) =>
        pointInPolygon(a.anchor, zone.polygon),
      );

      const { state: next, transition } = this.nextState(
        current,
        anchorsInside.length > 0,
      );
      this.states.set(key, next);

      if (transition === 'ENTER') {
        transitions.push({
          zoneId: zone.zoneId,
          eventType: ZoneEventType.PERSON_ENTERED_ZONE,
          confidence: Math.max(...anchorsInside.map((a) => a.detScore)),
          personsInZone: anchorsInside.length,
          anchor: anchorsInside[0].anchor,
        });
      } else if (transition === 'EXIT') {
        transitions.push({
          zoneId: zone.zoneId,
          eventType: ZoneEventType.PERSON_EXITED_ZONE,
          confidence: null,
          personsInZone: 0,
          anchor: null,
        });
      }
    }

    return transitions;
  }

  /** Clears all zone state for a camera (zone edit or camera disable). */
  reset(cameraId: string): void {
    const prefix = `${cameraId}:`;
    for (const key of this.states.keys()) {
      if (key.startsWith(prefix)) {
        this.states.delete(key);
      }
    }
  }

  private key(cameraId: string, zoneId: string): string {
    return `${cameraId}:${zoneId}`;
  }

  private nextState(
    current: ZoneOccupancyState,
    hasAnyInside: boolean,
  ): { state: ZoneOccupancyState; transition?: 'ENTER' | 'EXIT' } {
    switch (current.state) {
      case 'Outside':
        return hasAnyInside ? this.advanceTowardEnter(0) : { state: OUTSIDE };

      case 'CandidateInside':
        return hasAnyInside
          ? this.advanceTowardEnter(current.consecutiveCount)
          : { state: OUTSIDE };

      case 'Inside':
        return hasAnyInside ? { state: INSIDE } : this.advanceTowardExit(0);

      case 'CandidateOutside':
        return hasAnyInside
          ? { state: INSIDE }
          : this.advanceTowardExit(current.consecutiveCount);
    }
  }

  private advanceTowardEnter(previousCount: number): {
    state: ZoneOccupancyState;
    transition?: 'ENTER';
  } {
    const count = previousCount + 1;
    if (count >= this.enterConsecutivePolls) {
      return { state: INSIDE, transition: 'ENTER' };
    }
    return { state: { state: 'CandidateInside', consecutiveCount: count } };
  }

  private advanceTowardExit(previousCount: number): {
    state: ZoneOccupancyState;
    transition?: 'EXIT';
  } {
    const count = previousCount + 1;
    if (count >= this.exitConsecutivePolls) {
      return { state: OUTSIDE, transition: 'EXIT' };
    }
    return { state: { state: 'CandidateOutside', consecutiveCount: count } };
  }
}
