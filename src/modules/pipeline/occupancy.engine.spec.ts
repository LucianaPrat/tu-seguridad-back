import { AlertType } from '@prisma/client';
import { FULL_FRAME } from '../zones/rectangle';
import {
  AnchorWithScore,
  OccupancyEngine,
  ZoneInput,
} from './occupancy.engine';

describe('OccupancyEngine', () => {
  const zoneA: ZoneInput = {
    zoneId: 'zone-a',
    alertType: AlertType.intruder,
    area: { x: 0, y: 0, width: 50, height: 50 },
  };
  const zoneB: ZoneInput = {
    zoneId: 'zone-b',
    alertType: AlertType.suspicious,
    area: { x: 50, y: 50, width: 50, height: 50 },
  };
  const fullFrameZone: ZoneInput = {
    zoneId: null,
    alertType: AlertType.suspicious,
    area: FULL_FRAME,
  };

  const insideA: AnchorWithScore = { anchor: { x: 10, y: 10 }, detScore: 0.9 };
  const insideB: AnchorWithScore = { anchor: { x: 90, y: 90 }, detScore: 0.6 };

  describe('entering a zone', () => {
    it('does not transition on the first poll', () => {
      const engine = new OccupancyEngine(2, 2, 3);

      expect(engine.evaluate('camera-1', [zoneA], [insideA])).toEqual([]);
    });

    it('fires entered on the second consecutive poll, with the max score as confidence', () => {
      const engine = new OccupancyEngine(2, 2, 3);
      const secondPerson: AnchorWithScore = {
        anchor: { x: 20, y: 20 },
        detScore: 0.95,
      };

      engine.evaluate('camera-1', [zoneA], [insideA]);
      const poll2 = engine.evaluate(
        'camera-1',
        [zoneA],
        [insideA, secondPerson],
      );

      expect(poll2).toEqual([
        {
          zoneId: 'zone-a',
          alertType: AlertType.intruder,
          kind: 'entered',
          confidence: 0.95,
          personsInZone: 2,
        },
      ]);
    });

    it('drops the interrupted run when the window is exactly the hits required', () => {
      const engine = new OccupancyEngine(2, 2, 3);

      engine.evaluate('camera-1', [zoneA], [insideA]); // window [X]
      engine.evaluate('camera-1', [zoneA], []); // window [X, .] -> 1 hit of 2
      const poll3 = engine.evaluate('camera-1', [zoneA], [insideA]); // [., X]

      expect(poll3).toEqual([]);
    });
  });

  describe('the entry window (K of N)', () => {
    it('confirms K hits inside the window even when they are not consecutive', () => {
      const engine = new OccupancyEngine(2, 4, 3);

      engine.evaluate('camera-1', [zoneA], [insideA]); // [X]
      engine.evaluate('camera-1', [zoneA], []); // [X, .]
      const poll3 = engine.evaluate('camera-1', [zoneA], [insideA]); // [X, ., X]

      expect(poll3).toEqual([
        {
          zoneId: 'zone-a',
          alertType: AlertType.intruder,
          kind: 'entered',
          confidence: 0.9,
          personsInZone: 1,
        },
      ]);
    });

    it('does not confirm a single hit, however wide the window', () => {
      const engine = new OccupancyEngine(2, 4, 3);

      engine.evaluate('camera-1', [zoneA], [insideA]);
      engine.evaluate('camera-1', [zoneA], []);
      engine.evaluate('camera-1', [zoneA], []);
      const poll4 = engine.evaluate('camera-1', [zoneA], []);

      expect(poll4).toEqual([]);
    });

    it('slides, so a hit older than the window stops counting', () => {
      const engine = new OccupancyEngine(2, 3, 3);

      engine.evaluate('camera-1', [zoneA], [insideA]); // [X]
      engine.evaluate('camera-1', [zoneA], []); // [X, .]
      engine.evaluate('camera-1', [zoneA], []); // [X, ., .]
      // The first hit has now fallen out of a three-frame window, so this one
      // is alone again and must not confirm.
      const poll4 = engine.evaluate('camera-1', [zoneA], [insideA]); // [., ., X]

      expect(poll4).toEqual([]);
      expect(engine.hasPendingOccupancy('camera-1')).toBe(true);
    });

    it('stops being pending once the window has slid past the last sighting', () => {
      const engine = new OccupancyEngine(2, 2, 3);

      engine.evaluate('camera-1', [zoneA], [insideA]);
      expect(engine.hasPendingOccupancy('camera-1')).toBe(true);

      engine.evaluate('camera-1', [zoneA], []);
      engine.evaluate('camera-1', [zoneA], []);

      expect(engine.hasPendingOccupancy('camera-1')).toBe(false);
    });

    it('behaves exactly like the consecutive rule when hits equal the window', () => {
      const consecutive = new OccupancyEngine(3, 3, 3);

      consecutive.evaluate('camera-1', [zoneA], [insideA]);
      consecutive.evaluate('camera-1', [zoneA], []);
      consecutive.evaluate('camera-1', [zoneA], [insideA]);
      const interrupted = consecutive.evaluate('camera-1', [zoneA], [insideA]);
      expect(interrupted).toEqual([]);

      const third = consecutive.evaluate('camera-1', [zoneA], [insideA]);
      expect(third).toHaveLength(1);
    });

    it('refuses a window narrower than the hits it must hold', () => {
      expect(() => new OccupancyEngine(3, 2, 3)).toThrow(
        'enterHitsRequired (3) cannot exceed enterWindowPolls (2)',
      );
    });
  });

  describe('exiting a zone', () => {
    it('fires exited only after exitConsecutivePolls empty polls, with no confidence', () => {
      const engine = new OccupancyEngine(2, 2, 3);

      engine.evaluate('camera-1', [zoneA], [insideA]); // 1/2
      engine.evaluate('camera-1', [zoneA], [insideA]); // 2/2 -> entered

      engine.evaluate('camera-1', [zoneA], []); // 1/3
      const notYetExited = engine.evaluate('camera-1', [zoneA], []); // 2/3
      expect(notYetExited).toEqual([]);

      const poll = engine.evaluate('camera-1', [zoneA], []); // 3/3 -> exited

      expect(poll).toEqual([
        {
          zoneId: 'zone-a',
          alertType: AlertType.intruder,
          kind: 'exited',
          confidence: null,
          personsInZone: 0,
        },
      ]);
    });
  });

  describe('full-frame camera (monitorMode = full)', () => {
    it('transitions the implicit zoneId: null zone the same way, without colliding with a real zone', () => {
      const engine = new OccupancyEngine(2, 2, 3);
      // Inside FULL_FRAME but outside zoneA's rectangle (0,0,50,50): only the
      // full-frame zone should progress towards entered.
      const outsideRealZone: AnchorWithScore = {
        anchor: { x: 75, y: 75 },
        detScore: 0.8,
      };
      const zones = [zoneA, fullFrameZone];

      engine.evaluate('camera-1', zones, [outsideRealZone]); // full-frame 1/2, zoneA stays Outside
      const poll2 = engine.evaluate('camera-1', zones, [outsideRealZone]); // full-frame 2/2 -> entered

      expect(poll2).toEqual([
        {
          zoneId: null,
          alertType: AlertType.suspicious,
          kind: 'entered',
          confidence: 0.8,
          personsInZone: 1,
        },
      ]);

      // zoneA now starts its own count from zero, unaffected by the
      // already-Inside full-frame zone sharing the same evaluate() call.
      const poll3 = engine.evaluate('camera-1', zones, [insideA]);
      expect(poll3).toEqual([]);
      const poll4 = engine.evaluate('camera-1', zones, [insideA]);
      expect(poll4).toEqual([
        {
          zoneId: 'zone-a',
          alertType: AlertType.intruder,
          kind: 'entered',
          confidence: 0.9,
          personsInZone: 1,
        },
      ]);
    });
  });

  describe('partial mode with two zones', () => {
    it('reports each zone at its own alertType level', () => {
      const engine = new OccupancyEngine(2, 2, 3);
      const zones = [zoneA, zoneB];

      engine.evaluate('camera-1', zones, [insideA, insideB]); // both 1/2
      const poll2 = engine.evaluate('camera-1', zones, [insideA, insideB]);

      expect(poll2).toEqual([
        {
          zoneId: 'zone-a',
          alertType: AlertType.intruder,
          kind: 'entered',
          confidence: 0.9,
          personsInZone: 1,
        },
        {
          zoneId: 'zone-b',
          alertType: AlertType.suspicious,
          kind: 'entered',
          confidence: 0.6,
          personsInZone: 1,
        },
      ]);
    });
  });

  describe('multiple cameras', () => {
    it('keeps independent state per camera for the same zone id', () => {
      const engine = new OccupancyEngine(2, 2, 3);

      engine.evaluate('camera-2', [zoneA], [insideA]); // camera-2: 1/2
      const camera2Entered = engine.evaluate('camera-2', [zoneA], [insideA]); // camera-2: 2/2 -> entered
      expect(camera2Entered).toEqual([
        {
          zoneId: 'zone-a',
          alertType: AlertType.intruder,
          kind: 'entered',
          confidence: 0.9,
          personsInZone: 1,
        },
      ]);

      // camera-1 has not been polled yet: its own count starts from zero,
      // unaffected by camera-2 already being Inside for the same zoneId.
      const camera1FirstPoll = engine.evaluate('camera-1', [zoneA], [insideA]);
      expect(camera1FirstPoll).toEqual([]);
    });
  });

  describe('reset', () => {
    it('clears only the given camera state', () => {
      const engine = new OccupancyEngine(2, 2, 3);

      engine.evaluate('camera-1', [zoneA], [insideA]); // camera-1: 1/2
      engine.evaluate('camera-2', [zoneA], [insideA]); // camera-2: 1/2

      engine.reset('camera-1');

      const camera1AfterReset = engine.evaluate('camera-1', [zoneA], [insideA]);
      expect(camera1AfterReset).toEqual([]); // back to 1/2, not 2/2

      const camera2Unaffected = engine.evaluate('camera-2', [zoneA], [insideA]);
      expect(camera2Unaffected).toEqual([
        {
          zoneId: 'zone-a',
          alertType: AlertType.intruder,
          kind: 'entered',
          confidence: 0.9,
          personsInZone: 1,
        },
      ]);
    });
  });

  describe('hasPendingOccupancy', () => {
    it('is false for a camera with nothing going on', () => {
      const engine = new OccupancyEngine(2, 2, 3);

      expect(engine.hasPendingOccupancy('camera-1')).toBe(false);

      engine.evaluate('camera-1', [zoneA], []);
      expect(engine.hasPendingOccupancy('camera-1')).toBe(false);
    });

    it('is true from the first frame inside, before the entry is confirmed', () => {
      const engine = new OccupancyEngine(2, 2, 3);

      engine.evaluate('camera-1', [zoneA], [insideA]); // CandidateInside

      expect(engine.hasPendingOccupancy('camera-1')).toBe(true);
    });

    it('stays true through the unconfirmed exit and clears once the zone retires', () => {
      const engine = new OccupancyEngine(2, 2, 3);
      engine.evaluate('camera-1', [zoneA], [insideA]);
      engine.evaluate('camera-1', [zoneA], [insideA]); // Inside

      engine.evaluate('camera-1', [zoneA], []); // CandidateOutside 1/3
      expect(engine.hasPendingOccupancy('camera-1')).toBe(true);
      engine.evaluate('camera-1', [zoneA], []); // 2/3
      expect(engine.hasPendingOccupancy('camera-1')).toBe(true);
      engine.evaluate('camera-1', [zoneA], []); // 3/3, exited

      expect(engine.hasPendingOccupancy('camera-1')).toBe(false);
    });

    it('is true while any one zone is pending, and never leaks across cameras', () => {
      const engine = new OccupancyEngine(2, 2, 3);

      engine.evaluate('camera-1', [zoneA, zoneB], [insideB]);

      expect(engine.hasPendingOccupancy('camera-1')).toBe(true);
      expect(engine.hasPendingOccupancy('camera-2')).toBe(false);
    });

    it('is false again after a reset', () => {
      const engine = new OccupancyEngine(2, 2, 3);
      engine.evaluate('camera-1', [fullFrameZone], [insideA]);

      engine.reset('camera-1');

      expect(engine.hasPendingOccupancy('camera-1')).toBe(false);
    });
  });
});
