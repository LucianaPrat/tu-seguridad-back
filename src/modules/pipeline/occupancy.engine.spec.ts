import { ZoneEventType } from '@prisma/client';
import { OccupancyEngine, ZoneInput } from './occupancy.engine';

describe('OccupancyEngine', () => {
  const zoneSquare: ZoneInput = {
    zoneId: 'zone_a',
    enabled: true,
    polygon: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  };

  const inside = { anchor: { x: 0.5, y: 0.5 }, detScore: 0.9 };
  const outside = { anchor: { x: 5, y: 5 }, detScore: 0.9 };

  it('does not fire ENTER before ENTER_CONSECUTIVE_POLLS hits', () => {
    const engine = new OccupancyEngine(2, 3);

    const poll1 = engine.evaluate('camera_01', [zoneSquare], [inside]);

    expect(poll1).toEqual([]);
  });

  it('fires ENTER exactly after ENTER_CONSECUTIVE_POLLS consecutive hits', () => {
    const engine = new OccupancyEngine(2, 3);

    engine.evaluate('camera_01', [zoneSquare], [inside]);
    const poll2 = engine.evaluate('camera_01', [zoneSquare], [inside]);

    expect(poll2).toEqual([
      {
        zoneId: 'zone_a',
        eventType: ZoneEventType.PERSON_ENTERED_ZONE,
        confidence: 0.9,
        personsInZone: 1,
        anchor: inside.anchor,
      },
    ]);
  });

  it('a flicker (in, out, in) does not fire ENTER', () => {
    const engine = new OccupancyEngine(2, 3);

    engine.evaluate('camera_01', [zoneSquare], [inside]); // in (1/2)
    engine.evaluate('camera_01', [zoneSquare], [outside]); // out -> resets
    const poll3 = engine.evaluate('camera_01', [zoneSquare], [inside]); // in (1/2 again)

    expect(poll3).toEqual([]);
  });

  it('fires EXIT after EXIT_CONSECUTIVE_POLLS consecutive misses', () => {
    const engine = new OccupancyEngine(2, 3);
    engine.evaluate('camera_01', [zoneSquare], [inside]);
    engine.evaluate('camera_01', [zoneSquare], [inside]); // now Inside

    engine.evaluate('camera_01', [zoneSquare], [outside]); // miss 1/3
    engine.evaluate('camera_01', [zoneSquare], [outside]); // miss 2/3
    const exitPoll = engine.evaluate('camera_01', [zoneSquare], [outside]); // miss 3/3

    expect(exitPoll).toEqual([
      {
        zoneId: 'zone_a',
        eventType: ZoneEventType.PERSON_EXITED_ZONE,
        confidence: null,
        personsInZone: 0,
        anchor: null,
      },
    ]);
  });

  it('fires ENTER again on re-entry after an exit', () => {
    const engine = new OccupancyEngine(2, 3);
    engine.evaluate('camera_01', [zoneSquare], [inside]);
    engine.evaluate('camera_01', [zoneSquare], [inside]); // Inside
    engine.evaluate('camera_01', [zoneSquare], [outside]);
    engine.evaluate('camera_01', [zoneSquare], [outside]);
    engine.evaluate('camera_01', [zoneSquare], [outside]); // Outside again, EXIT fired

    engine.evaluate('camera_01', [zoneSquare], [inside]); // re-enter 1/2
    const reenterPoll = engine.evaluate('camera_01', [zoneSquare], [inside]); // 2/2

    expect(reenterPoll[0]).toMatchObject({
      eventType: ZoneEventType.PERSON_ENTERED_ZONE,
    });
  });

  it('evaluates two zones independently', () => {
    // zone_a is the left half, zone_b the right half - the same anchor can
    // only ever be inside one of them.
    const zoneLeft: ZoneInput = {
      zoneId: 'zone_a',
      enabled: true,
      polygon: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
        { x: 0, y: 1 },
      ],
    };
    const zoneRight: ZoneInput = {
      zoneId: 'zone_b',
      enabled: true,
      polygon: [
        { x: 0.5, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0.5, y: 1 },
      ],
    };
    const anchorInLeft = { anchor: { x: 0.25, y: 0.5 }, detScore: 0.9 };
    const engine = new OccupancyEngine(2, 3);

    engine.evaluate('camera_01', [zoneLeft, zoneRight], [anchorInLeft]);
    const poll2 = engine.evaluate(
      'camera_01',
      [zoneLeft, zoneRight],
      [anchorInLeft],
    );

    expect(poll2).toEqual([expect.objectContaining({ zoneId: 'zone_a' })]);
  });

  it('reset() clears stored state for a camera (zone edit)', () => {
    const engine = new OccupancyEngine(2, 3);
    engine.evaluate('camera_01', [zoneSquare], [inside]); // CandidateInside(1)

    engine.reset('camera_01');

    engine.evaluate('camera_01', [zoneSquare], [inside]); // should be back to (1/2), not (2/2)
    const poll = engine.evaluate('camera_01', [zoneSquare], [outside]);

    expect(poll).toEqual([]);
  });

  it('ignores a disabled zone entirely', () => {
    const disabledZone: ZoneInput = { ...zoneSquare, enabled: false };
    const engine = new OccupancyEngine(2, 3);

    const poll1 = engine.evaluate('camera_01', [disabledZone], [inside]);
    const poll2 = engine.evaluate('camera_01', [disabledZone], [inside]);

    expect(poll1).toEqual([]);
    expect(poll2).toEqual([]);
  });
});
