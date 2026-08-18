import { AlertType } from '@prisma/client';
import { PipelineDefaults } from '../../cross/common/constants';
import { containsPoint, Point, Rectangle } from '../zones/rectangle';

type OccupancyStateName =
  'Outside' | 'CandidateInside' | 'Inside' | 'CandidateOutside';

interface ZoneOccupancyState {
  state: OccupancyStateName;
  consecutiveCount: number;
}

export interface ZoneInput {
  /** `null` for the implicit full-frame area of a `monitorMode = full` camera. */
  zoneId: string | null;
  alertType: AlertType;
  rectangle: Rectangle;
}

export interface AnchorWithScore {
  /** Percent of the frame, already converted from the detector's [0,1]. */
  anchor: Point;
  detScore: number;
}

export interface OccupancyTransition {
  zoneId: string | null;
  alertType: AlertType;
  kind: 'entered' | 'exited';
  confidence: number | null;
  personsInZone: number;
}

const OUTSIDE: ZoneOccupancyState = { state: 'Outside', consecutiveCount: 0 };
const INSIDE: ZoneOccupancyState = { state: 'Inside', consecutiveCount: 0 };
const FULL_FRAME_KEY = 'full-frame';

/**
 * Per (camera, zone) occupancy state machine with hysteresis: a person has to
 * be seen inside for N consecutive polls before an entry counts, and missing
 * for M before an exit does. Pure domain logic, no I/O — which is what lets the
 * poll transport stay undecided.
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
      const key = this.key(cameraId, zone.zoneId);
      const current = this.states.get(key) ?? OUTSIDE;
      const anchorsInside = anchors.filter((candidate) =>
        containsPoint(zone.rectangle, candidate.anchor),
      );

      const { state: next, transition } = this.nextState(
        current,
        anchorsInside.length > 0,
      );
      this.states.set(key, next);

      if (transition === 'ENTER') {
        transitions.push({
          zoneId: zone.zoneId,
          alertType: zone.alertType,
          kind: 'entered',
          confidence: Math.max(
            ...anchorsInside.map((candidate) => candidate.detScore),
          ),
          personsInZone: anchorsInside.length,
        });
      } else if (transition === 'EXIT') {
        transitions.push({
          zoneId: zone.zoneId,
          alertType: zone.alertType,
          kind: 'exited',
          confidence: null,
          personsInZone: 0,
        });
      }
    }

    return transitions;
  }

  /** Clears all zone state for a camera (zone edit, disable or delete). */
  reset(cameraId: string): void {
    const prefix = `${cameraId}:`;
    for (const key of this.states.keys()) {
      if (key.startsWith(prefix)) {
        this.states.delete(key);
      }
    }
  }

  private key(cameraId: string, zoneId: string | null): string {
    return `${cameraId}:${zoneId ?? FULL_FRAME_KEY}`;
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
