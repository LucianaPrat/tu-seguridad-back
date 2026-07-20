import { PipelineService } from './pipeline.service';
import { OccupancyEngine } from './occupancy.engine';

describe('PipelineService', () => {
  const camera = {
    id: 'camera_01',
    confidenceThreshold: 0.5,
  };

  const zone = {
    id: 'zone_lobby',
    cameraId: 'camera_01',
    enabled: true,
    polygon: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  };

  function personDetection(detScore: number, anchor: { x: number; y: number }) {
    return {
      detScore,
      bbox: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } },
      bboxNorm: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } },
      anchor,
    };
  }

  let faceAuthClient: { detectPersons: jest.Mock };
  let zoneAccessor: { findByCamera: jest.Mock };
  let eventsService: { emit: jest.Mock };
  let statusRegistry: { record: jest.Mock };
  let service: PipelineService;

  beforeEach(() => {
    faceAuthClient = { detectPersons: jest.fn() };
    zoneAccessor = { findByCamera: jest.fn().mockResolvedValue([zone]) };
    eventsService = {
      emit: jest
        .fn()
        .mockImplementation((data) => Promise.resolve({ id: 1, ...data })),
    };
    statusRegistry = { record: jest.fn() };
    service = new PipelineService(
      faceAuthClient as never,
      zoneAccessor as never,
      eventsService as never,
      statusRegistry as never,
      new OccupancyEngine(2, 3),
    );
  });

  it('returns the upstream error unchanged when detection fails', async () => {
    faceAuthClient.detectPersons.mockResolvedValue({
      ok: false,
      code: 'UPSTREAM_TIMEOUT',
      message: 'timed out',
    });

    const result = await service.processImage(
      camera as never,
      Buffer.from('x'),
    );

    expect(result).toEqual({
      ok: false,
      code: 'UPSTREAM_TIMEOUT',
      message: 'timed out',
    });
    expect(statusRegistry.record).toHaveBeenCalledWith(
      'camera_01',
      expect.objectContaining({ lastErrorCode: 'UPSTREAM_TIMEOUT' }),
    );
  });

  it('filters out persons below the camera confidence threshold', async () => {
    faceAuthClient.detectPersons.mockResolvedValue({
      ok: true,
      data: {
        personsDetected: true,
        imageWidth: 100,
        imageHeight: 100,
        persons: [
          personDetection(0.2, { x: 0.5, y: 0.5 }),
          personDetection(0.9, { x: 0.5, y: 0.5 }),
        ],
      },
    });

    const result = await service.processImage(
      camera as never,
      Buffer.from('x'),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.persons).toHaveLength(1);
      expect(result.data.persons[0].detScore).toBe(0.9);
      expect(result.data.zoneResults).toEqual([
        { zoneId: 'zone_lobby', occupied: true },
      ]);
    }
  });

  it('emits ENTERED only once hysteresis confirms after N polls, and EXITED after M misses', async () => {
    const insideResponse = {
      ok: true,
      data: {
        personsDetected: true,
        imageWidth: 100,
        imageHeight: 100,
        persons: [personDetection(0.9, { x: 0.5, y: 0.5 })],
      },
    };
    const outsideResponse = {
      ok: true,
      data: {
        personsDetected: false,
        imageWidth: 100,
        imageHeight: 100,
        persons: [],
      },
    };

    faceAuthClient.detectPersons.mockResolvedValue(insideResponse);
    const poll1 = await service.processImage(camera as never, Buffer.from('x'));
    const poll2 = await service.processImage(camera as never, Buffer.from('x'));

    expect(poll1.ok && poll1.data.eventsEmitted).toEqual([]);
    expect(poll2.ok && poll2.data.eventsEmitted).toHaveLength(1);
    expect(poll2.ok && poll2.data.eventsEmitted[0]).toMatchObject({
      eventType: 'PERSON_ENTERED_ZONE',
      zoneId: 'zone_lobby',
    });

    faceAuthClient.detectPersons.mockResolvedValue(outsideResponse);
    await service.processImage(camera as never, Buffer.from('x'));
    await service.processImage(camera as never, Buffer.from('x'));
    const exitPoll = await service.processImage(
      camera as never,
      Buffer.from('x'),
    );

    expect(exitPoll.ok && exitPoll.data.eventsEmitted).toHaveLength(1);
    expect(exitPoll.ok && exitPoll.data.eventsEmitted[0]).toMatchObject({
      eventType: 'PERSON_EXITED_ZONE',
      zoneId: 'zone_lobby',
    });
  });

  it('records lastSuccessAt/lastLatencyMs/lastPersonsDetected on success', async () => {
    faceAuthClient.detectPersons.mockResolvedValue({
      ok: true,
      data: {
        personsDetected: false,
        imageWidth: 1,
        imageHeight: 1,
        persons: [],
      },
    });

    await service.processImage(camera as never, Buffer.from('x'));

    expect(statusRegistry.record).toHaveBeenCalledWith(
      'camera_01',
      expect.objectContaining({
        lastPersonsDetected: false,
        zones: [{ zoneId: 'zone_lobby', occupied: false }],
      }),
    );
  });
});
