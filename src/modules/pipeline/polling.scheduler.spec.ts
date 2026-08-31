import { Camera } from '@prisma/client';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError } from '../../cross/errors/either';
import { CadenceEngine } from './cadence.engine';
import { PollingScheduler } from './polling.scheduler';

const PASSIVE = 15;
const ACTIVE = 10;
const DETECTION = 5;

function buildCamera(id: string): Camera {
  return {
    id,
    dvrId: 'dvr-uuid',
    externalId: `channel-${id}`,
    name: id,
    location: null,
    status: 'online',
    isConfigured: true,
    isEnabled: true,
    monitorMode: 'full',
    alertType: 'intruder',
    lastSnapshotAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

const capturedImage = {
  data: Buffer.from('image'),
  mimeType: 'image/jpeg',
  byteSize: 5,
  sha256: 'a'.repeat(64),
  capturedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('PollingScheduler', () => {
  let config: Record<string, unknown>;
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };
  let dvrAccessor: { findSpaceIdsWithDvr: jest.Mock };
  let cameraAccessor: { findPollableBySpace: jest.Mock };
  let snapshotService: { capture: jest.Mock; store: jest.Mock };
  let pipelineService: { processImage: jest.Mock };
  let statusRegistry: { record: jest.Mock; incrementSkipped: jest.Mock };
  let schedulerRegistry: { addInterval: jest.Mock; deleteInterval: jest.Mock };
  let cadenceEngine: CadenceEngine;
  let scheduler: PollingScheduler;

  beforeEach(() => {
    config = {
      [EnvNames.POLLING_ENABLED]: true,
    };
    configService = {
      get: jest.fn((key: string) => config[key]),
      getOrThrow: jest.fn((key: string) => config[key]),
    };
    dvrAccessor = { findSpaceIdsWithDvr: jest.fn().mockResolvedValue([]) };
    cameraAccessor = { findPollableBySpace: jest.fn().mockResolvedValue([]) };
    snapshotService = {
      capture: jest.fn().mockResolvedValue(buildData(capturedImage)),
      store: jest.fn().mockResolvedValue(buildData({ id: 'snapshot-uuid' })),
    };
    pipelineService = {
      processImage: jest.fn().mockResolvedValue(
        buildData({
          persons: [],
          zoneResults: [],
          alerts: [],
          occupancyPending: false,
        }),
      ),
    };
    statusRegistry = { record: jest.fn(), incrementSkipped: jest.fn() };
    schedulerRegistry = { addInterval: jest.fn(), deleteInterval: jest.fn() };
    // Real engine: which ticks a camera sits out is the behaviour under test,
    // and a mock that answers "due" to everything would test nothing.
    cadenceEngine = new CadenceEngine(PASSIVE, ACTIVE, DETECTION);
    scheduler = new PollingScheduler(
      configService as never,
      dvrAccessor as never,
      cameraAccessor as never,
      snapshotService as never,
      pipelineService as never,
      statusRegistry as never,
      cadenceEngine,
      schedulerRegistry as never,
    );
  });

  // Several cadence tests move the clock with `jest.spyOn(Date, 'now')`, and
  // `restoreMocks` is not on in this project's Jest config.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('lifecycle', () => {
    it('registers nothing while polling is disabled', () => {
      config[EnvNames.POLLING_ENABLED] = false;

      scheduler.onApplicationBootstrap();
      scheduler.onModuleDestroy();

      expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
      expect(schedulerRegistry.deleteInterval).not.toHaveBeenCalled();
    });

    it('registers one interval for the whole process and clears it on destroy', () => {
      jest.useFakeTimers();
      try {
        scheduler.onApplicationBootstrap();
        expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
          'camera-poll',
          expect.anything(),
        );

        scheduler.onModuleDestroy();
        expect(schedulerRegistry.deleteInterval).toHaveBeenCalledWith(
          'camera-poll',
        );
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });
  });

  describe('tick', () => {
    it('polls every pollable camera of every space that owns a recorder', async () => {
      dvrAccessor.findSpaceIdsWithDvr.mockResolvedValue(['space-a', 'space-b']);
      cameraAccessor.findPollableBySpace.mockImplementation((spaceId: string) =>
        Promise.resolve(
          spaceId === 'space-a'
            ? [buildCamera('camera-a1'), buildCamera('camera-a2')]
            : [buildCamera('camera-b1')],
        ),
      );

      await scheduler.tick();

      expect(pipelineService.processImage).toHaveBeenCalledTimes(3);
      expect(snapshotService.capture).toHaveBeenCalledWith(
        'space-a',
        expect.objectContaining({ id: 'camera-a1' }),
      );
    });

    it('keeps polling the remaining cameras and spaces after one throws', async () => {
      dvrAccessor.findSpaceIdsWithDvr.mockResolvedValue(['space-a', 'space-b']);
      cameraAccessor.findPollableBySpace.mockImplementation((spaceId: string) =>
        Promise.resolve(
          spaceId === 'space-a'
            ? [buildCamera('camera-a1'), buildCamera('camera-a2')]
            : [buildCamera('camera-b1')],
        ),
      );
      snapshotService.capture.mockImplementation((_: string, camera: Camera) =>
        camera.id === 'camera-a1'
          ? Promise.reject(new Error('recorder exploded'))
          : Promise.resolve(buildData(capturedImage)),
      );

      await scheduler.tick();

      expect(snapshotService.capture).toHaveBeenCalledTimes(3);
      expect(statusRegistry.record).toHaveBeenCalledWith(
        'camera-a1',
        expect.objectContaining({ lastErrorCode: ErrorCode.INTERNAL_ERROR }),
      );
    });
  });

  describe('pollOnce', () => {
    it('counts a skipped poll instead of queueing behind the previous one', async () => {
      let release: (() => void) | undefined;
      snapshotService.capture.mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve(buildData(capturedImage));
        }),
      );

      const inFlight = scheduler.pollOnce('space-a', buildCamera('camera-a1'));
      await scheduler.pollOnce('space-a', buildCamera('camera-a1'));

      expect(statusRegistry.incrementSkipped).toHaveBeenCalledWith('camera-a1');
      expect(snapshotService.capture).toHaveBeenCalledTimes(1);

      release?.();
      await inFlight;
    });

    it('refreshes the live frame on every successful poll, alert or not', async () => {
      await scheduler.pollOnce('space-a', buildCamera('camera-a1'));

      expect(snapshotService.store).toHaveBeenCalledWith(
        'space-a',
        'camera-a1',
        capturedImage,
        true,
      );
    });

    it('records a failed live write and still runs detection', async () => {
      snapshotService.store.mockResolvedValue(
        buildError(
          ErrorCode.VALIDATION_ERROR,
          'Snapshot is larger than the 1 byte limit',
        ),
      );

      await scheduler.pollOnce('space-a', buildCamera('camera-a1'));

      expect(pipelineService.processImage).toHaveBeenCalledTimes(1);
      expect(statusRegistry.record).toHaveBeenCalledWith(
        'camera-a1',
        expect.objectContaining({ lastErrorCode: ErrorCode.VALIDATION_ERROR }),
      );
    });

    it('records the capture failure and does not store or run detection', async () => {
      snapshotService.capture.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_TIMEOUT, 'DVR snapshot fetch timed out'),
      );

      await scheduler.pollOnce('space-a', buildCamera('camera-a1'));

      expect(statusRegistry.record).toHaveBeenCalledWith(
        'camera-a1',
        expect.objectContaining({ lastErrorCode: ErrorCode.UPSTREAM_TIMEOUT }),
      );
      expect(snapshotService.store).not.toHaveBeenCalled();
      expect(pipelineService.processImage).not.toHaveBeenCalled();
    });

    it('releases the in-flight slot even when the poll throws', async () => {
      snapshotService.capture.mockRejectedValueOnce(new Error('socket closed'));

      await expect(
        scheduler.pollOnce('space-a', buildCamera('camera-a1')),
      ).rejects.toThrow('socket closed');

      snapshotService.capture.mockResolvedValue(buildData(capturedImage));
      await scheduler.pollOnce('space-a', buildCamera('camera-a1'));

      expect(pipelineService.processImage).toHaveBeenCalledTimes(1);
    });
  });

  describe('cadence', () => {
    const analysisWith = (
      overrides: { persons?: unknown[]; occupancyPending?: boolean } = {},
    ) =>
      buildData({
        persons: overrides.persons ?? [],
        zoneResults: [],
        alerts: [],
        occupancyPending: overrides.occupancyPending ?? false,
      });

    beforeEach(() => {
      dvrAccessor.findSpaceIdsWithDvr.mockResolvedValue(['space-a']);
      cameraAccessor.findPollableBySpace.mockResolvedValue([
        buildCamera('camera-a1'),
      ]);
    });

    it('ticks at the shortest rung of the ladder', () => {
      jest.useFakeTimers();
      try {
        const setInterval = jest.spyOn(global, 'setInterval');

        scheduler.onApplicationBootstrap();

        expect(setInterval).toHaveBeenCalledWith(
          expect.anything(),
          DETECTION * 1000,
        );
        scheduler.onModuleDestroy();
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it('skips a camera that is not due yet, without touching the recorder', async () => {
      await scheduler.tick();
      expect(snapshotService.capture).toHaveBeenCalledTimes(1);

      await scheduler.tick();

      expect(snapshotService.capture).toHaveBeenCalledTimes(1);
      expect(pipelineService.processImage).toHaveBeenCalledTimes(1);
      expect(snapshotService.store).toHaveBeenCalledTimes(1);
    });

    it('polls it again once its interval has elapsed', async () => {
      await scheduler.tick();

      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + PASSIVE * 1000 + 1);
      await scheduler.tick();

      expect(snapshotService.capture).toHaveBeenCalledTimes(2);
    });

    it('publishes the level a person inside a zone earned', async () => {
      pipelineService.processImage.mockResolvedValue(
        analysisWith({ persons: [{}], occupancyPending: true }),
      );

      await scheduler.tick();

      expect(cadenceEngine.level('camera-a1')).toBe('detection');
      expect(statusRegistry.record).toHaveBeenCalledWith('camera-a1', {
        pollLevel: 'detection',
        pollIntervalSeconds: DETECTION,
      });
    });

    it('drops to active when the frame still holds a person but no zone is pending', async () => {
      pipelineService.processImage.mockResolvedValue(
        analysisWith({ persons: [{}] }),
      );

      await scheduler.tick();

      expect(cadenceEngine.level('camera-a1')).toBe('active');
      expect(statusRegistry.record).toHaveBeenCalledWith('camera-a1', {
        pollLevel: 'active',
        pollIntervalSeconds: ACTIVE,
      });
    });

    it('holds the level a failed capture could say nothing about', async () => {
      pipelineService.processImage.mockResolvedValue(
        analysisWith({ persons: [{}], occupancyPending: true }),
      );
      await scheduler.tick();

      snapshotService.capture.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_TIMEOUT, 'DVR snapshot fetch timed out'),
      );
      const afterDetection = Date.now() + DETECTION * 1000 + 1;
      jest.spyOn(Date, 'now').mockReturnValue(afterDetection);
      await scheduler.tick();

      expect(cadenceEngine.level('camera-a1')).toBe('detection');
      // Re-armed rather than left due: a camera whose recorder is unreachable
      // must not be retried on every base tick.
      expect(cadenceEngine.isDue('camera-a1', afterDetection)).toBe(false);
    });

    it('re-arms a camera whose poll threw, so it does not retry every tick', async () => {
      snapshotService.capture.mockRejectedValue(new Error('socket closed'));

      await scheduler.tick();

      expect(cadenceEngine.isDue('camera-a1', Date.now())).toBe(false);
    });

    it('does not let a detection error freeze the camera at detection forever', async () => {
      pipelineService.processImage.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_ERROR, 'face-auth returned 500'),
      );

      await scheduler.tick();

      expect(cadenceEngine.level('camera-a1')).toBe('passive');
      expect(cadenceEngine.isDue('camera-a1', Date.now())).toBe(false);
    });
  });
});
