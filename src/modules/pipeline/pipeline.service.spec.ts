import { Camera, MonitorZone, Prisma } from '@prisma/client';
import sharp from 'sharp';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError } from '../../cross/errors/either';
import { CapturedImage } from '../dvr/dvr-client.port';
import { AlertCooldown } from './alert-cooldown';
import { CadenceEngine } from './cadence.engine';
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
    confidenceThreshold: null,
    minPollSeconds: null,
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
  points: MonitorZone['points'] = null,
): MonitorZone {
  return {
    id,
    cameraId: 'camera-uuid',
    x: new Prisma.Decimal(rectangle.x),
    y: new Prisma.Decimal(rectangle.y),
    width: new Prisma.Decimal(rectangle.width),
    height: new Prisma.Decimal(rectangle.height),
    points,
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
  let alertEvents: { record: jest.Mock };
  let alertsSuppressed: { inc: jest.Mock };
  let personsDetected: { inc: jest.Mock };
  let configService: { get: jest.Mock };
  let alertCooldown: AlertCooldown;
  let service: PipelineService;

  beforeEach(() => {
    faceAuthClient = { detectPersons: jest.fn() };
    zoneAccessor = { findByCamera: jest.fn().mockResolvedValue([]) };
    snapshotService = {
      store: jest.fn().mockResolvedValue(buildData({ id: 'snapshot-uuid' })),
    };
    statusRegistry = { record: jest.fn() };
    alertEvents = { record: jest.fn().mockResolvedValue([]) };
    alertsSuppressed = { inc: jest.fn() };
    personsDetected = { inc: jest.fn() };
    // Every flag this service reads is off unless a test turns it on.
    configService = { get: jest.fn().mockReturnValue(false) };
    // Off by default: every test outside the cooldown block must see the
    // pre-cooldown answer, and a real instance with a zero window is that.
    alertCooldown = new AlertCooldown(0);
    service = buildService();
  });

  /** Rebuilt by the cooldown block, which needs a non-zero window. */
  function buildService(): PipelineService {
    return new PipelineService(
      configService as never,
      faceAuthClient as never,
      zoneAccessor as never,
      snapshotService as never,
      statusRegistry as never,
      // Real engine with a one-poll threshold: alert-level selection is the
      // behavior under test, and mocking it away would test nothing.
      new OccupancyEngine(1, 1, 1),
      new CadenceEngine(15, 10, 5),
      alertEvents as never,
      alertCooldown,
      alertsSuppressed as never,
      personsDetected as never,
    );
  }

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

  /**
   * The notch of an L sits inside the bounding box the columns store. If the
   * outline were lost between the JSON column and the engine, the box would
   * answer for the shape and this anchor would raise an alert.
   */
  it('tests the anchor against the stored outline, not its bounding box', async () => {
    faceAuthClient.detectPersons.mockResolvedValue(detection());
    zoneAccessor.findByCamera.mockResolvedValue([
      buildZone(
        'zone-l',
        { x: 40, y: 40, width: 20, height: 20 },
        'intruder',
        // An L open at the top right; the anchor at 50,50 lands in the notch.
        [
          { x: 40, y: 40 },
          { x: 45, y: 40 },
          { x: 45, y: 55 },
          { x: 60, y: 55 },
          { x: 60, y: 60 },
          { x: 40, y: 60 },
        ],
      ),
    ]);

    const result = await service.processImage(
      spaceId,
      buildCamera({ monitorMode: 'partial', alertType: 'intruder' }),
      image,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.zoneResults).toEqual([
        { zoneId: 'zone-l', alertType: 'intruder', occupied: false },
      ]);
      expect(result.data.alerts).toHaveLength(0);
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

  /**
   * Re-encoding an annotated frame can push it over `SNAPSHOT_MAX_BYTES`, and an
   * alert whose evidence was dropped over a drawn rectangle is a regression on
   * an alert that simply had a frame. The unannotated bytes are the fallback.
   */
  it('falls back to the unannotated frame when the annotated one is refused', async () => {
    const decodable: CapturedImage = {
      ...image,
      data: await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 3,
          background: { r: 20, g: 20, b: 20 },
        },
      })
        .jpeg()
        .toBuffer(),
    };
    // `detection()` collapses the box onto the anchor; a real one is needed here,
    // or there is nothing to draw and the annotated bytes are the captured ones.
    faceAuthClient.detectPersons.mockResolvedValue(
      buildData({
        personsDetected: true,
        imageWidth: 64,
        imageHeight: 64,
        persons: [
          {
            detScore: 0.9,
            bbox: { topLeft: { x: 10, y: 10 }, bottomRight: { x: 40, y: 55 } },
            bboxNorm: {
              topLeft: { x: 0.15, y: 0.15 },
              bottomRight: { x: 0.62, y: 0.86 },
            },
            anchor: { x: 0.5, y: 0.5 },
          },
        ],
      }),
    );
    snapshotService.store
      .mockResolvedValueOnce(
        buildError(
          ErrorCode.VALIDATION_ERROR,
          'Snapshot is larger than the limit',
        ),
      )
      .mockResolvedValueOnce(buildData({ id: 'snapshot-uuid' }));

    const result = await service.processImage(
      spaceId,
      buildCamera(),
      decodable,
    );

    expect(snapshotService.store).toHaveBeenCalledTimes(2);
    // The retry carries the frame exactly as it was captured.
    expect(snapshotService.store).toHaveBeenLastCalledWith(
      spaceId,
      'camera-uuid',
      decodable,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.alerts[0].snapshotId).toBe('snapshot-uuid');
    }
  });

  it('does not retry the write when there was nothing to annotate', async () => {
    faceAuthClient.detectPersons.mockResolvedValue(detection());
    snapshotService.store.mockResolvedValue(
      buildError(ErrorCode.CONFLICT, 'database is down'),
    );

    await service.processImage(spaceId, buildCamera(), image);

    expect(snapshotService.store).toHaveBeenCalledTimes(1);
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

  it('hands the candidates it raised to the alert-event domain', async () => {
    faceAuthClient.detectPersons.mockResolvedValue(detection());

    await service.processImage(spaceId, buildCamera(), image);

    expect(alertEvents.record).toHaveBeenCalledWith(spaceId, [
      expect.objectContaining({
        cameraId: 'camera-uuid',
        cameraLabel: 'Front door – Street side',
        zoneId: null,
        alertType: 'intruder',
        snapshotId: 'snapshot-uuid',
      }),
    ]);
  });

  it('records nothing when the frame raised no alert', async () => {
    faceAuthClient.detectPersons.mockResolvedValue(
      buildData({
        personsDetected: false,
        imageWidth: 1920,
        imageHeight: 1080,
        persons: [],
      }),
    );

    await service.processImage(spaceId, buildCamera(), image);

    expect(alertEvents.record).not.toHaveBeenCalled();
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

  /**
   * The hysteresis already collapses a flickering detection into one cycle, so
   * a repeat needs a real exit and re-entry: person present, frame empty,
   * person present again. That is the sequence a cooldown exists for — at the
   * detection cadence it is a mail every couple of minutes, and the recipient
   * stops reading them.
   */
  describe('alert cooldown', () => {
    const camera = () =>
      buildCamera({ monitorMode: 'full', alertType: 'suspicious' });

    const emptyFrame = () =>
      buildData({
        personsDetected: false,
        imageWidth: 1920,
        imageHeight: 1080,
        persons: [],
      });

    /** Present, gone, present again. Answers the alerts of the last frame. */
    async function enterLeaveReturn() {
      faceAuthClient.detectPersons.mockResolvedValue(detection());
      await service.processImage(spaceId, camera(), image);
      faceAuthClient.detectPersons.mockResolvedValue(emptyFrame());
      await service.processImage(spaceId, camera(), image);
      faceAuthClient.detectPersons.mockResolvedValue(detection());
      return service.processImage(spaceId, camera(), image);
    }

    beforeEach(() => {
      alertCooldown = new AlertCooldown(60);
      service = buildService();
    });

    it('raises one alert for a re-entry inside the window', async () => {
      const result = await enterLeaveReturn();

      expect(result.ok && result.data.alerts).toHaveLength(0);
      expect(alertEvents.record).toHaveBeenCalledTimes(1);
    });

    it('counts what it suppressed', async () => {
      await enterLeaveReturn();

      expect(alertsSuppressed.inc).toHaveBeenCalledWith({
        cameraId: 'camera-uuid',
      });
    });

    /**
     * The point of consulting the cooldown before the frame is stored: a
     * suppressed candidate must not cost a MEDIUMBLOB write either.
     */
    it('stores no evidence frame for a suppressed candidate', async () => {
      faceAuthClient.detectPersons.mockResolvedValue(detection());
      await service.processImage(spaceId, camera(), image);
      faceAuthClient.detectPersons.mockResolvedValue(emptyFrame());
      await service.processImage(spaceId, camera(), image);
      snapshotService.store.mockClear();

      faceAuthClient.detectPersons.mockResolvedValue(detection());
      await service.processImage(spaceId, camera(), image);

      expect(snapshotService.store).not.toHaveBeenCalled();
    });

    it('raises again once the window has elapsed', async () => {
      const startedAt = Date.now();
      faceAuthClient.detectPersons.mockResolvedValue(detection());
      await service.processImage(spaceId, camera(), image);
      faceAuthClient.detectPersons.mockResolvedValue(emptyFrame());
      await service.processImage(spaceId, camera(), image);

      jest.spyOn(Date, 'now').mockReturnValue(startedAt + 61_000);
      faceAuthClient.detectPersons.mockResolvedValue(detection());
      const later = await service.processImage(spaceId, camera(), image);

      expect(later.ok && later.data.alerts).toHaveLength(1);
    });

    it('is off entirely at a zero window', async () => {
      alertCooldown = new AlertCooldown(0);
      service = buildService();

      const result = await enterLeaveReturn();

      expect(result.ok && result.data.alerts).toHaveLength(1);
      expect(alertsSuppressed.inc).not.toHaveBeenCalled();
    });
  });

  describe('what the detector answered', () => {
    const emptyBody = () =>
      buildData({
        personsDetected: false,
        imageWidth: 1920,
        imageHeight: 1080,
        persons: [],
      });

    it('counts a frame the upstream found somebody in', async () => {
      faceAuthClient.detectPersons.mockResolvedValue(detection());

      await service.processImage(spaceId, buildCamera(), image);

      expect(personsDetected.inc).toHaveBeenCalledWith({
        cameraId: 'camera-uuid',
        outcome: 'persons',
      });
    });

    it('counts an empty answer apart from a filtered one', async () => {
      faceAuthClient.detectPersons.mockResolvedValue(emptyBody());

      await service.processImage(spaceId, buildCamera(), image);

      expect(personsDetected.inc).toHaveBeenCalledWith({
        cameraId: 'camera-uuid',
        outcome: 'empty',
      });
    });

    it('counts a sighting this camera threw away as filtered, not empty', async () => {
      faceAuthClient.detectPersons.mockResolvedValue(
        detection({ x: 0.5, y: 0.5 }, 0.2),
      );

      await service.processImage(spaceId, buildCamera(), image);

      expect(personsDetected.inc).toHaveBeenCalledWith({
        cameraId: 'camera-uuid',
        outcome: 'filtered',
      });
    });

    it('does not count a poll the detector never answered', async () => {
      faceAuthClient.detectPersons.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_THROTTLED, 'rate limited'),
      );

      await service.processImage(spaceId, buildCamera(), image);

      expect(personsDetected.inc).not.toHaveBeenCalled();
    });
  });

  describe('keeping the raw evidence frame', () => {
    /**
     * A frame the annotator can actually decode and a box it can actually
     * draw — without both, `annotateDetections` hands back the captured object
     * and there is no second set of bytes for the raw copy to be about.
     */
    let decodable: CapturedImage;

    beforeEach(async () => {
      decodable = {
        ...image,
        data: await sharp({
          create: {
            width: 64,
            height: 64,
            channels: 3,
            background: { r: 20, g: 20, b: 20 },
          },
        })
          .jpeg()
          .toBuffer(),
      };
      faceAuthClient.detectPersons.mockResolvedValue(
        buildData({
          personsDetected: true,
          imageWidth: 64,
          imageHeight: 64,
          persons: [
            {
              detScore: 0.9,
              bbox: {
                topLeft: { x: 10, y: 10 },
                bottomRight: { x: 40, y: 55 },
              },
              bboxNorm: {
                topLeft: { x: 0.15, y: 0.15 },
                bottomRight: { x: 0.62, y: 0.86 },
              },
              anchor: { x: 0.5, y: 0.5 },
            },
          ],
        }),
      );
    });

    it('stores only the annotated frame by default', async () => {
      await service.processImage(spaceId, buildCamera(), decodable);

      expect(snapshotService.store).toHaveBeenCalledTimes(1);
    });

    it('stores the untouched capture as a second row when asked to', async () => {
      configService.get.mockReturnValue(true);

      await service.processImage(spaceId, buildCamera(), decodable);

      expect(snapshotService.store).toHaveBeenCalledTimes(2);
      // The raw copy is the object handed in, not the annotated re-encode.
      expect(snapshotService.store).toHaveBeenLastCalledWith(
        spaceId,
        'camera-uuid',
        decodable,
      );
    });

    it('never lets a failed raw copy cost the alert', async () => {
      configService.get.mockReturnValue(true);
      snapshotService.store
        .mockResolvedValueOnce(buildData({ id: 'snapshot-uuid' }))
        .mockResolvedValueOnce(buildError(ErrorCode.INTERNAL_ERROR, 'nope'));

      const result = await service.processImage(
        spaceId,
        buildCamera(),
        decodable,
      );

      expect(result).toMatchObject({ ok: true });
      expect(alertEvents.record).toHaveBeenCalled();
    });
  });

  describe('per-camera confidence threshold', () => {
    /**
     * A street and a hallway need different numbers, and until the column
     * existed tuning one detuned the other.
     */
    it('uses the camera threshold over the deployment default', async () => {
      faceAuthClient.detectPersons.mockResolvedValue(detection(undefined, 0.4));

      const result = await service.processImage(
        spaceId,
        buildCamera({
          monitorMode: 'full',
          alertType: 'suspicious',
          confidenceThreshold: new Prisma.Decimal('0.300'),
        }),
        image,
      );

      expect(result.ok && result.data.persons).toHaveLength(1);
    });

    it('drops a person below the camera threshold', async () => {
      faceAuthClient.detectPersons.mockResolvedValue(detection(undefined, 0.4));

      const result = await service.processImage(
        spaceId,
        buildCamera({
          monitorMode: 'full',
          alertType: 'suspicious',
          confidenceThreshold: new Prisma.Decimal('0.900'),
        }),
        image,
      );

      expect(result.ok && result.data.persons).toHaveLength(0);
      expect(result.ok && result.data.alerts).toHaveLength(0);
    });

    it('falls back to the deployment default when the camera has none', async () => {
      faceAuthClient.detectPersons.mockResolvedValue(detection(undefined, 0.4));

      const result = await service.processImage(
        spaceId,
        buildCamera({ monitorMode: 'full', alertType: 'suspicious' }),
        image,
      );

      // 0.4 is under the shipped default of 0.45, so a camera with no
      // threshold of its own still drops the person. Same score as the two
      // tests above: only the threshold changed between them.
      expect(result.ok && result.data.persons).toHaveLength(0);
    });
  });
});
