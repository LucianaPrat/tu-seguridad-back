import { AlertType } from '@prisma/client';
import { PipelineDefaults } from '../../cross/common/constants';
import { containsPoint, Point, ZoneArea } from '../zones/rectangle';

interface ZoneOccupancyState {
  /** The area is confirmed occupied — an `ENTER` has fired and no `EXIT` yet. */
  inside: boolean;
  /**
   * The last `enterWindowPolls` observations while the area is not yet
   * confirmed, oldest first, `true` when the frame put an anchor inside. Empty
   * once the area is `inside`: the window's whole job is deciding entry.
   */
  window: boolean[];
  /** Consecutive frames with nothing inside, counted only while `inside`. */
  misses: number;
}

export interface ZoneInput {
  /** `null` for the implicit full-frame area of a `monitorMode = full` camera. */
  zoneId: string | null;
  alertType: AlertType;
  area: ZoneArea;
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

const OUTSIDE: ZoneOccupancyState = { inside: false, window: [], misses: 0 };
const INSIDE: ZoneOccupancyState = { inside: true, window: [], misses: 0 };
const FULL_FRAME_KEY = 'full-frame';

/**
 * Per (camera, zone) occupancy state machine with hysteresis: an area is
 * entered once `enterHitsRequired` of the last `enterWindowPolls` frames put a
 * person inside it, and exited after `exitConsecutivePolls` frames with nobody.
 * Pure domain logic, no I/O — which is what lets the poll transport stay
 * undecided.
 *
 * Entry is a window rather than a run of consecutive hits because the upstream
 * detector drops frames of a subject that never moved: measured on 2026-09-02
 * at one detection in 33 frames of an IR night scene with a person standing in
 * it, which makes two consecutive hits a ~0.1% event and that camera unable to
 * alert at all. See `plans/05.detection-quality.md`. Setting
 * `enterHitsRequired === enterWindowPolls` reproduces the old consecutive rule
 * exactly, which is the way back if the detector ever stops needing this.
 *
 * Exit stays consecutive on purpose. A premature exit costs nothing — the area
 * simply re-arms — while a lingering one suppresses the next real alert, and a
 * single frame that sees the person again resets the miss count to zero.
 */
export class OccupancyEngine {
  private readonly states = new Map<string, ZoneOccupancyState>();

  constructor(
    private readonly enterHitsRequired: number = PipelineDefaults.ENTER_HITS_REQUIRED,
    private readonly enterWindowPolls: number = PipelineDefaults.ENTER_WINDOW_POLLS,
    private readonly exitConsecutivePolls: number = PipelineDefaults.EXIT_CONSECUTIVE_POLLS,
  ) {
    // A window shorter than the hits it must contain can never confirm an
    // entry, so the camera would poll forever and never alert. Joi rejects the
    // pair at boot; this is here so a direct construction cannot bypass it.
    if (enterHitsRequired > enterWindowPolls) {
      throw new Error(
        `enterHitsRequired (${enterHitsRequired}) cannot exceed enterWindowPolls (${enterWindowPolls})`,
      );
    }
  }

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
        containsPoint(zone.area, candidate.anchor),
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

  /**
   * True while any area of this camera has unfinished business: a sighting
   * inside its entry window, or a confirmed occupancy whose exit is not settled
   * yet. What the poll cadence keys on, so the camera speeds up on the raw
   * sighting and only slows down once the window has slid past it.
   */
  hasPendingOccupancy(cameraId: string): boolean {
    const prefix = `${cameraId}:`;
    for (const [key, occupancy] of this.states) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      if (occupancy.inside || occupancy.window.includes(true)) {
        return true;
      }
    }
    return false;
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
    if (!current.inside) {
      const window = [...current.window, hasAnyInside].slice(
        -this.enterWindowPolls,
      );
      const hits = window.filter(Boolean).length;
      return hits >= this.enterHitsRequired
        ? { state: INSIDE, transition: 'ENTER' }
        : { state: { inside: false, window, misses: 0 } };
    }

    if (hasAnyInside) {
      return { state: INSIDE };
    }

    const misses = current.misses + 1;
    return misses >= this.exitConsecutivePolls
      ? { state: OUTSIDE, transition: 'EXIT' }
      : { state: { inside: true, window: [], misses } };
  }
}
