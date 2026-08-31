import { PersonDetection } from '../face-auth-client/detect-persons-response';
import { AnalysisResult } from './analysis-result';
import { CadenceEngine, levelFor } from './cadence.engine';

const PASSIVE = 15;
const ACTIVE = 10;
const DETECTION = 5;

const box = { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } };
const person: PersonDetection = {
  detScore: 0.9,
  bbox: box,
  bboxNorm: box,
  anchor: { x: 0.1, y: 0.9 },
};

function buildResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    persons: [],
    zoneResults: [],
    alerts: [],
    occupancyPending: false,
    ...overrides,
  };
}

const empty = buildResult();
const inFrame = buildResult({ persons: [person] });
const inZone = buildResult({ persons: [person], occupancyPending: true });

describe('CadenceEngine', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  let engine: CadenceEngine;

  beforeEach(() => {
    engine = new CadenceEngine(PASSIVE, ACTIVE, DETECTION);
  });

  describe('levelFor', () => {
    it('is passive when the frame held nobody', () => {
      expect(levelFor(empty)).toBe('passive');
    });

    it('is active when a person is in the frame but no zone is pending', () => {
      expect(levelFor(inFrame)).toBe('active');
    });

    it('is detection while a zone is pending, even with nobody in this frame', () => {
      // The person walked out of the zone but the exit is not confirmed yet:
      // the camera stays fast until the hysteresis retires the zone.
      expect(levelFor(buildResult({ occupancyPending: true }))).toBe(
        'detection',
      );
    });
  });

  describe('tickSeconds', () => {
    it('is the shortest rung, so the scheduler can honour it', () => {
      expect(engine.tickSeconds).toBe(DETECTION);
    });

    it('follows the configuration rather than assuming detection is fastest', () => {
      expect(new CadenceEngine(3, 10, 5).tickSeconds).toBe(3);
    });
  });

  describe('isDue', () => {
    it('is due when it has never been polled', () => {
      expect(engine.isDue('camera-1', now)).toBe(true);
    });

    it('is not due again until its interval has elapsed', () => {
      engine.record('camera-1', empty, now);

      expect(engine.isDue('camera-1', now + (PASSIVE - 1) * 1000)).toBe(false);
      expect(engine.isDue('camera-1', now + PASSIVE * 1000)).toBe(true);
    });

    it('tracks cameras independently', () => {
      engine.record('camera-1', empty, now);

      expect(engine.isDue('camera-1', now + 1000)).toBe(false);
      expect(engine.isDue('camera-2', now + 1000)).toBe(true);
    });
  });

  describe('record', () => {
    it('walks the ladder up and back down as the frames change', () => {
      expect(engine.record('camera-1', empty, now)).toEqual({
        level: 'passive',
        seconds: PASSIVE,
        changed: true, // first sight: one line per camera at boot
      });
      expect(engine.record('camera-1', inFrame, now)).toEqual({
        level: 'active',
        seconds: ACTIVE,
        changed: true,
      });
      expect(engine.record('camera-1', inZone, now)).toEqual({
        level: 'detection',
        seconds: DETECTION,
        changed: true,
      });
      expect(engine.record('camera-1', inFrame, now)).toEqual({
        level: 'active',
        seconds: ACTIVE,
        changed: true,
      });
      expect(engine.record('camera-1', empty, now)).toEqual({
        level: 'passive',
        seconds: PASSIVE,
        changed: true,
      });
    });

    it('reports no change while the level holds', () => {
      engine.record('camera-1', inZone, now);

      expect(engine.record('camera-1', inZone, now).changed).toBe(false);
    });

    it('arms the next poll at the new level, not the old one', () => {
      engine.record('camera-1', empty, now);
      engine.record('camera-1', inZone, now);

      expect(engine.isDue('camera-1', now + (DETECTION - 1) * 1000)).toBe(
        false,
      );
      expect(engine.isDue('camera-1', now + DETECTION * 1000)).toBe(true);
    });
  });

  describe('rearm', () => {
    it('holds the level a failed poll could say nothing about', () => {
      engine.record('camera-1', inZone, now);

      engine.rearm('camera-1', now + DETECTION * 1000);

      expect(engine.level('camera-1')).toBe('detection');
      expect(engine.isDue('camera-1', now + DETECTION * 1000)).toBe(false);
      expect(engine.isDue('camera-1', now + 2 * DETECTION * 1000)).toBe(true);
    });

    it('pushes a never-polled camera out at the passive rung', () => {
      engine.rearm('camera-1', now);

      expect(engine.level('camera-1')).toBe('passive');
      expect(engine.isDue('camera-1', now + (PASSIVE - 1) * 1000)).toBe(false);
    });
  });

  describe('reset', () => {
    it('drops the camera back to due-now and leaves the others alone', () => {
      engine.record('camera-1', inZone, now);
      engine.record('camera-2', inZone, now);

      engine.reset('camera-1');

      expect(engine.isDue('camera-1', now)).toBe(true);
      expect(engine.level('camera-1')).toBe('passive');
      expect(engine.isDue('camera-2', now)).toBe(false);
    });
  });
});
