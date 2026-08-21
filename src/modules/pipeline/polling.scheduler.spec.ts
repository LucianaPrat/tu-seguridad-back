import { Camera } from '@prisma/client';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError } from '../../cross/errors/either';
import { PollingScheduler } from './polling.scheduler';

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
  let scheduler: PollingScheduler;

  beforeEach(() => {
    config = {
      [EnvNames.POLLING_ENABLED]: true,
      [EnvNames.POLLING_INTERVAL_SECONDS]: 5,
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
      processImage: jest
        .fn()
        .mockResolvedValue(
          buildData({ persons: [], zoneResults: [], alerts: [] }),
        ),
    };
    statusRegistry = { record: jest.fn(), incrementSkipped: jest.fn() };
    schedulerRegistry = { addInterval: jest.fn(), deleteInterval: jest.fn() };
    scheduler = new PollingScheduler(
      configService as never,
      dvrAccessor as never,
      cameraAccessor as never,
      snapshotService as never,
      pipelineService as never,
      statusRegistry as never,
      schedulerRegistry as never,
    );
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
});
