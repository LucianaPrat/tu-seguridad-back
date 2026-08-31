import { AnalysisResult } from './analysis-result';

export type CadenceLevel = 'passive' | 'active' | 'detection';

interface CameraCadence {
  level: CadenceLevel;
  dueAt: number;
}

export interface CadenceDecision {
  level: CadenceLevel;
  seconds: number;
  /** The level moved. Callers log on this rather than on every poll. */
  changed: boolean;
}

/**
 * How fast a camera should be polled, from what its last frame showed.
 *
 * Up on the raw sighting, down on the confirmed one: a person inside a monitor
 * zone puts that zone past `Outside` on the very first frame, so the camera is
 * already at the detection cadence while the occupancy hysteresis is still
 * confirming the entry — and it stays there until the hysteresis has retired
 * the zone, not merely until one frame came back empty. Stepping down on the
 * first empty frame would leave the zone stuck `Inside` for
 * `EXIT_CONSECUTIVE_POLLS` passive-length polls, and a second person walking in
 * during that window would raise no alert.
 *
 * Pure domain logic, no I/O — same shape as `OccupancyEngine`, and the reason
 * the scheduler can stay one interval for the whole process.
 */
export class CadenceEngine {
  private readonly cameras = new Map<string, CameraCadence>();

  constructor(
    private readonly passiveSeconds: number,
    private readonly activeSeconds: number,
    private readonly detectionSeconds: number,
  ) {}

  /**
   * The granularity the scheduler's interval must run at. Anything slower and
   * the shortest rung could not be honoured; anything faster only burns ticks
   * on cameras that are not due.
   */
  get tickSeconds(): number {
    return Math.min(
      this.passiveSeconds,
      this.activeSeconds,
      this.detectionSeconds,
    );
  }

  /** Never polled, or its interval has elapsed. */
  isDue(cameraId: string, now: number): boolean {
    const current = this.cameras.get(cameraId);
    return current === undefined || current.dueAt <= now;
  }

  /** Re-arms the camera from what the frame showed. */
  record(
    cameraId: string,
    result: AnalysisResult,
    now: number,
  ): CadenceDecision {
    const previous = this.cameras.get(cameraId)?.level;
    const level = levelFor(result);
    const seconds = this.secondsFor(level);
    this.cameras.set(cameraId, { level, dueAt: now + seconds * 1000 });
    // First sight counts as a change: one line per camera on the first tick
    // after boot is what confirms the ladder is actually running.
    return { level, seconds, changed: previous !== level };
  }

  /**
   * Re-arms at the level the camera already had — the poll failed or was
   * skipped, so the frame said nothing about how fast to go. Without this a
   * camera whose recorder is down stays due on every tick and retries at the
   * base cadence, which is the opposite of what a dead recorder needs.
   */
  rearm(cameraId: string, now: number): void {
    const level = this.level(cameraId);
    this.cameras.set(cameraId, {
      level,
      dueAt: now + this.secondsFor(level) * 1000,
    });
  }

  level(cameraId: string): CadenceLevel {
    return this.cameras.get(cameraId)?.level ?? 'passive';
  }

  /** Drops the camera back to "due now, passive" (zone edit, disable, delete). */
  reset(cameraId: string): void {
    this.cameras.delete(cameraId);
  }

  private secondsFor(level: CadenceLevel): number {
    switch (level) {
      case 'detection':
        return this.detectionSeconds;
      case 'active':
        return this.activeSeconds;
      case 'passive':
        return this.passiveSeconds;
    }
  }
}

/**
 * A `monitorMode = full` camera never sees `active`: its whole frame is the
 * monitored area, so any person it detects is already inside the zone.
 */
export function levelFor(result: AnalysisResult): CadenceLevel {
  if (result.occupancyPending) {
    return 'detection';
  }
  return result.persons.length > 0 ? 'active' : 'passive';
}
