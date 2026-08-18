import { Camera, MonitorZone, Prisma } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError } from '../../cross/errors/either';
import { CapturedImage } from '../dvr/dvr-client.port';
import { OccupancyEngine } from './occupancy.engine';
import { PipelineService } from './pipeline.service';

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
    lastSnapshotAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildZone(
  id: string,
  rectangle: { x: number; y: number; width: number; height: number },
  alertType: 'intruder' | 'suspicious',
): MonitorZone {
  return {
    id,
    cameraId: 'camera-uuid',
    x: new Prisma.Decimal(rectangle.x),
    y: new Prisma.Decimal(rectangle.y),
    width: new Prisma.Decimal(rectangle.width),
    height: new Prisma.Decimal(rectangle.height),
    alertType,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

const image: CapturedImage = {
  data: Buffer.from('image-bytes'),
  mimeType: 'image/jpeg',
  byteSize: 11,
  sha256: 'a'.repeat(64),
  capturedAt: new Date('2026-01-01T00:00:00Z'),
};

/** Anchors are normalized [0,1]; this one sits in the middle of the frame. */
function detection(anchor = { x: 0.5, y: 0.5 }, detScore = 0.9) {
  return buildData({
    personsDetected: true,
    imageWidth: 1920,
    imageHeight: 1080,
    persons: [
      {
        detScore,
        bbox: { topLeft: anchor, bottomRight: anchor },
        bboxNorm: { topLeft: anchor, bottomRight: anchor },
        anchor,
      },
    ],
  });
}

describe('PipelineService', () => {
  const spaceId = 'space-uuid';

  let faceAuthClient: { detectPersons: jest.Mock };
  let zoneAccessor: { findByCamera: jest.Mock };
  let snapshotService: { store: jest.Mock };
  let statusRegistry: { record: jest.Mock };
  let alertEmitter: { emit: jest.Mock };
  let service: PipelineService;

  beforeEach(() => {
    faceAuthClient = { detectPersons: jest.fn() };
    zoneAccessor = { findByCamera: jest.fn().mockResolvedValue([]) };
    snapshotService = {
      store: jest.fn().mockResolvedValue(buildData({ id: 'snapshot-uuid' })),
    };
    statusRegistry = { record: jest.fn() };
    alertEmitter = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new PipelineService(
      faceAuthClient as never,
      zoneAccessor as never,
      snapshotService as never,
      statusRegistry as never,
      // Real engine with a one-poll threshold: alert-level selection is the
      // behavior under test, and mocking it away would test nothing.
      new OccupancyEngine(1, 1),
      alertEmitter,
    );
  });

  describe('cameras it refuses to process', () => {
    it('rejects a soft-deleted camera', async () => {
      const result = await service.processImage(
        spaceId,
        buildCamera({ deletedAt: new Date() }),
        image,
      );

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
      expect(faceAuthClient.detectPersons).not.toHaveBeenCalled();
    });

    it('rejects a disabled camera', async () => {
      const result = await service.processImage(
        spaceId,
        buildCamera({ isEnabled: false }),
        image,
      );

      expect(result).toMatchObject({ ok: false, code: ErrorCode.CONFLICT });
      expect(faceAuthClient.detectPersons).not.toHaveBeenCalled();
    });

    it('rejects a camera with no monitor configuration', async () => {
      const result = await service.processImage(
        spaceId,
        buildCamera({ isConfigured: false }),
        image,
      );

      expect(result).toMatchObject({ ok: false, code: ErrorCode.CONFLICT });
      expect(faceAuthClient.detectPersons).not.toHaveBeenCalled();
    });
  });

  it('raises the camera alert level over the whole frame in full mode', async () => {
    faceAuthClient.detectPersons.mockResolvedValue(detection());

    const result = await service.processImage(
      spaceId,
      buildCamera({ monitorMode: 'full', alertType: 'suspicious' }),
      image,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.alerts).toHaveLength(1);
      expect(result.data.alerts[0]).toMatchObject({
        zoneId: null,
        alertType: 'suspicious',
        cameraLabel: 'Front door – Street side',
        snapshotId: 'snapshot-uuid',
      });
    }
    expect(zoneAccessor.findByCamera).not.toHaveBeenCalled();
  });

  it('raises the level of the zone the person walked into in partial mode', async () => {
    faceAuthClient.detectPersons.mockResolvedValue(detection());
    zoneAccessor.findByCamera.mockResolvedValue([
      buildZone(
        'zone-left',
        { x: 0, y: 0, width: 20, height: 100 },
        'intruder',
      ),
      buildZone(
        'zone-middle',
        { x: 40, y: 40, width: 20, height: 20 },
        'suspicious',
      ),
    ]);

    const result = await service.processImage(
      spaceId,
      buildCamera({ monitorMode: 'partial', alertType: 'intruder' }),
      image,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.alerts).toHaveLength(1);
      expect(result.data.alerts[0]).toMatchObject({
        zoneId: 'zone-middle',
        alertType: 'suspicious',
      });
      expect(result.data.zoneResults).toEqual([
        { zoneId: 'zone-left', alertType: 'intruder', occupied: false },
        { zoneId: 'zone-middle', alertType: 'suspicious', occupied: true },
      ]);
    }
  });

  it('stores the frame only when an alert is raised', async () => {
    faceAuthClient.detectPersons.mockResolvedValue(
      buildData({
        personsDetected: false,
        imageWidth: 1920,
        imageHeight: 1080,
        persons: [],
      }),
    );

    const result = await service.processImage(spaceId, buildCamera(), image);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.alerts).toHaveLength(0);
    }
    expect(snapshotService.store).not.toHaveBeenCalled();
    expect(alertEmitter.emit).not.toHaveBeenCalled();
  });

  it('hands every raised alert to the emitter with its space', async () => {
    faceAuthClient.detectPersons.mockResolvedValue(detection());

    await service.processImage(spaceId, buildCamera(), image);

    expect(alertEmitter.emit).toHaveBeenCalledTimes(1);
    expect(alertEmitter.emit).toHaveBeenCalledWith(
      spaceId,
      expect.objectContaining({
        cameraId: 'camera-uuid',
        alertType: 'intruder',
      }),
    );
  });

  it('still reports the alert when the frame could not be stored', async () => {
    faceAuthClient.detectPersons.mockResolvedValue(detection());
    snapshotService.store.mockResolvedValue(
      buildError(
        ErrorCode.VALIDATION_ERROR,
        'Snapshot is larger than the limit',
      ),
    );

    const result = await service.processImage(spaceId, buildCamera(), image);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.alerts[0].snapshotId).toBeNull();
    }
  });

  it('ignores detections below the confidence threshold', async () => {
    faceAuthClient.detectPersons.mockResolvedValue(
      detection({ x: 0.5, y: 0.5 }, 0.1),
    );

    const result = await service.processImage(spaceId, buildCamera(), image);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.persons).toHaveLength(0);
      expect(result.data.alerts).toHaveLength(0);
    }
  });

  it('records the upstream failure and passes it through', async () => {
    faceAuthClient.detectPersons.mockResolvedValue(
      buildError(
        ErrorCode.UPSTREAM_TIMEOUT,
        'face-auth detect request timed out',
      ),
    );

    const result = await service.processImage(spaceId, buildCamera(), image);

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_TIMEOUT,
    });
    expect(statusRegistry.record).toHaveBeenCalledWith(
      'camera-uuid',
      expect.objectContaining({ lastErrorCode: ErrorCode.UPSTREAM_TIMEOUT }),
    );
  });
});
