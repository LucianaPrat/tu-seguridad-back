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
    rectangle: { x: 0, y: 0, width: 50, height: 50 },
  };
  const zoneB: ZoneInput = {
    zoneId: 'zone-b',
    alertType: AlertType.suspicious,
    rectangle: { x: 50, y: 50, width: 50, height: 50 },
  };
  const fullFrameZone: ZoneInput = {
    zoneId: null,
    alertType: AlertType.suspicious,
    rectangle: FULL_FRAME,
  };

  const insideA: AnchorWithScore = { anchor: { x: 10, y: 10 }, detScore: 0.9 };
  const insideB: AnchorWithScore = { anchor: { x: 90, y: 90 }, detScore: 0.6 };

  describe('entering a zone', () => {
    it('does not transition on the first poll', () => {
      const engine = new OccupancyEngine(2, 3);

      expect(engine.evaluate('camera-1', [zoneA], [insideA])).toEqual([]);
    });

    it('fires entered on the second consecutive poll, with the max score as confidence', () => {
      const engine = new OccupancyEngine(2, 3);
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

    it('resets the counter on an empty poll, so an interrupted run never enters', () => {
      const engine = new OccupancyEngine(2, 3);

      engine.evaluate('camera-1', [zoneA], [insideA]); // 1/2
      engine.evaluate('camera-1', [zoneA], []); // nobody -> back to Outside
      const poll3 = engine.evaluate('camera-1', [zoneA], [insideA]); // 1/2 again

      expect(poll3).toEqual([]);
    });
  });

  describe('exiting a zone', () => {
    it('fires exited only after exitConsecutivePolls empty polls, with no confidence', () => {
      const engine = new OccupancyEngine(2, 3);

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
      const engine = new OccupancyEngine(2, 3);
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
      const engine = new OccupancyEngine(2, 3);
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
      const engine = new OccupancyEngine(2, 3);

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
      const engine = new OccupancyEngine(2, 3);

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
});
