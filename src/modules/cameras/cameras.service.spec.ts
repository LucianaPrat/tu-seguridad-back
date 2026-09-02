import { Camera } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError } from '../../cross/errors/either';
import { CamerasService } from './cameras.service';

const MAX_SNAPSHOT_BYTES = 1000;

function buildCamera(overrides: Partial<Camera> = {}): Camera {
  return {
    id: 'camera-uuid',
    dvrId: 'dvr-uuid',
    externalId: 'channel-1',
    name: 'Front door',
    location: 'Street side',
    status: 'online',
    isConfigured: true,
    isEnabled: true,
    monitorMode: 'full',
    alertType: 'intruder',
    lastSnapshotAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('CamerasService', () => {
  const spaceId = 'space-uuid';

  let cameraAccessor: {
    findAll: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
    countMonitorZones: jest.Mock;
  };
  let snapshotService: {
    findLatestIds: jest.Mock;
    captureAndStore: jest.Mock;
  };
  let statusRegistry: { get: jest.Mock; forget: jest.Mock };
  let pipelineService: { processImage: jest.Mock; resetCameraState: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let pollingScheduler: { forget: jest.Mock };
  let liveStreamService: { forget: jest.Mock };
  let service: CamerasService;

  beforeEach(() => {
    cameraAccessor = {
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      countMonitorZones: jest.fn(),
    };
    snapshotService = {
      findLatestIds: jest.fn().mockResolvedValue(new Map()),
      captureAndStore: jest.fn(),
    };
    statusRegistry = { get: jest.fn(), forget: jest.fn() };
    pipelineService = { processImage: jest.fn(), resetCameraState: jest.fn() };
    configService = {
      getOrThrow: jest.fn().mockReturnValue(MAX_SNAPSHOT_BYTES),
    };
    pollingScheduler = { forget: jest.fn() };
    liveStreamService = { forget: jest.fn().mockResolvedValue(undefined) };
    service = new CamerasService(
      cameraAccessor as never,
      snapshotService as never,
      statusRegistry as never,
      pipelineService as never,
      configService as never,
      pollingScheduler as never,
      liveStreamService as never,
    );
  });

  describe('findAll', () => {
    it('derives latestSnapshotUrl from the latest stored snapshot', async () => {
      cameraAccessor.findAll.mockResolvedValue([buildCamera()]);
      snapshotService.findLatestIds.mockResolvedValue(
        new Map([['camera-uuid', 'snapshot-uuid']]),
      );

      const result = await service.findAll(spaceId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data[0].latestSnapshotUrl).toBe(
          '/api/v1/snapshots/snapshot-uuid',
        );
      }
    });

    it('reports no snapshot url for a camera that has never stored one', async () => {
      cameraAccessor.findAll.mockResolvedValue([buildCamera()]);

      const result = await service.findAll(spaceId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data[0].latestSnapshotUrl).toBeNull();
      }
    });

    it('never exposes a DVR-derived url on a list item', async () => {
      cameraAccessor.findAll.mockResolvedValue([buildCamera()]);

      const result = await service.findAll(spaceId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.keys(result.data[0])).not.toContain('snapshotUrl');
      }
    });
  });

  describe('findById', () => {
    it('returns NOT_FOUND for a camera outside the space', async () => {
      cameraAccessor.findById.mockResolvedValue(null);

      const result = await service.findById(spaceId, 'camera-uuid');

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
    });
  });

  describe('update', () => {
    it('rejects full-frame monitoring without an alert level', async () => {
      cameraAccessor.findById.mockResolvedValue(
        buildCamera({ alertType: null, monitorMode: 'partial' }),
      );

      const result = await service.update(spaceId, 'camera-uuid', {
        monitorMode: 'full',
      });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(cameraAccessor.update).not.toHaveBeenCalled();
    });

    it('marks a full-frame camera configured once it carries an alert level', async () => {
      const camera = buildCamera({ alertType: null, isConfigured: false });
      cameraAccessor.findById.mockResolvedValue(camera);
      cameraAccessor.update.mockResolvedValue(
        buildCamera({ alertType: 'suspicious' }),
      );

      await service.update(spaceId, 'camera-uuid', {
        alertType: 'suspicious',
      });

      expect(cameraAccessor.update).toHaveBeenCalledWith(
        spaceId,
        'camera-uuid',
        expect.objectContaining({
          alertType: 'suspicious',
          isConfigured: true,
        }),
      );
    });

    it('leaves a partial camera unconfigured while it has no zones', async () => {
      cameraAccessor.findById.mockResolvedValue(buildCamera());
      cameraAccessor.countMonitorZones.mockResolvedValue(0);
      cameraAccessor.update.mockResolvedValue(
        buildCamera({ monitorMode: 'partial', isConfigured: false }),
      );

      await service.update(spaceId, 'camera-uuid', {
        monitorMode: 'partial',
      });

      expect(cameraAccessor.update).toHaveBeenCalledWith(
        spaceId,
        'camera-uuid',
        expect.objectContaining({ isConfigured: false }),
      );
    });

    it('configures a partial camera that already has a zone', async () => {
      cameraAccessor.findById.mockResolvedValue(buildCamera());
      cameraAccessor.countMonitorZones.mockResolvedValue(2);
      cameraAccessor.update.mockResolvedValue(
        buildCamera({ monitorMode: 'partial' }),
      );

      await service.update(spaceId, 'camera-uuid', {
        monitorMode: 'partial',
      });

      expect(cameraAccessor.update).toHaveBeenCalledWith(
        spaceId,
        'camera-uuid',
        expect.objectContaining({ isConfigured: true }),
      );
    });

    it('resets occupancy when monitor configuration changes', async () => {
      cameraAccessor.findById.mockResolvedValue(buildCamera());
      cameraAccessor.countMonitorZones.mockResolvedValue(1);
      cameraAccessor.update.mockResolvedValue(
        buildCamera({ monitorMode: 'partial' }),
      );

      await service.update(spaceId, 'camera-uuid', {
        monitorMode: 'partial',
      });

      expect(pipelineService.resetCameraState).toHaveBeenCalledWith(
        'camera-uuid',
      );
    });
  });

  describe('delete', () => {
    it('reports NOT_FOUND when nothing was soft-deleted', async () => {
      cameraAccessor.softDelete.mockResolvedValue(false);

      const result = await service.delete(spaceId, 'camera-uuid');

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
    });

    it('succeeds on a logical delete', async () => {
      cameraAccessor.softDelete.mockResolvedValue(true);

      await expect(service.delete(spaceId, 'camera-uuid')).resolves.toEqual({
        ok: true,
        data: null,
      });
    });

    /**
     * A camera id can come back — the recorder rediscovers a channel that was
     * deleted and reconfigured — and it must not inherit anything the process
     * remembered about the camera that used to hold it.
     */
    it('forgets every piece of per-camera state the process holds', async () => {
      cameraAccessor.softDelete.mockResolvedValue(true);

      await service.delete(spaceId, 'camera-uuid');

      expect(pipelineService.resetCameraState).toHaveBeenCalledWith(
        'camera-uuid',
      );
      expect(statusRegistry.forget).toHaveBeenCalledWith('camera-uuid');
      expect(pollingScheduler.forget).toHaveBeenCalledWith('camera-uuid');
      expect(liveStreamService.forget).toHaveBeenCalledWith(
        spaceId,
        'camera-uuid',
      );
    });

    it('forgets nothing when there was nothing to delete', async () => {
      cameraAccessor.softDelete.mockResolvedValue(false);

      await service.delete(spaceId, 'camera-uuid');

      expect(statusRegistry.forget).not.toHaveBeenCalled();
      expect(pollingScheduler.forget).not.toHaveBeenCalled();
      expect(liveStreamService.forget).not.toHaveBeenCalled();
    });
  });

  describe('capture', () => {
    it('returns the stored snapshot as an authorized url, never as bytes', async () => {
      cameraAccessor.findById.mockResolvedValue(buildCamera());
      snapshotService.captureAndStore.mockResolvedValue(
        buildData({
          id: 'snapshot-uuid',
          cameraId: 'camera-uuid',
          mimeType: 'image/jpeg',
          byteSize: 12,
          capturedAt: new Date('2026-01-01T00:00:00Z'),
          data: Buffer.from('bytes'),
        }),
      );

      const result = await service.capture(spaceId, 'camera-uuid');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.url).toBe('/api/v1/snapshots/snapshot-uuid');
        expect(Object.keys(result.data)).not.toContain('data');
      }
    });

    it('passes a capture failure through', async () => {
      cameraAccessor.findById.mockResolvedValue(buildCamera());
      snapshotService.captureAndStore.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_TIMEOUT, 'DVR snapshot fetch timed out'),
      );

      const result = await service.capture(spaceId, 'camera-uuid');

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_TIMEOUT,
      });
    });
  });

  describe('analyze', () => {
    it('rejects an upload larger than the snapshot limit before any lookup', async () => {
      const result = await service.analyze(
        spaceId,
        'camera-uuid',
        Buffer.alloc(MAX_SNAPSHOT_BYTES + 1),
        'image/jpeg',
      );

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(cameraAccessor.findById).not.toHaveBeenCalled();
    });

    it('hands the described image to the pipeline', async () => {
      const camera = buildCamera();
      cameraAccessor.findById.mockResolvedValue(camera);
      pipelineService.processImage.mockResolvedValue(
        buildData({ persons: [], zoneResults: [], alerts: [] }),
      );

      await service.analyze(
        spaceId,
        'camera-uuid',
        Buffer.from('image'),
        'image/jpeg',
      );

      expect(pipelineService.processImage).toHaveBeenCalledWith(
        spaceId,
        camera,
        expect.objectContaining({ mimeType: 'image/jpeg', byteSize: 5 }),
      );
    });
  });
});
