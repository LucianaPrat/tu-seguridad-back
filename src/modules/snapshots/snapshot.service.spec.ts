import { Camera, CameraStatus, Snapshot } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError } from '../../cross/errors/either';
import { DvrCredentials } from '../../data/accessors/dvr.accessor';
import { CapturedImage } from '../dvr/dvr-client.port';
import { describeImage, SnapshotService } from './snapshot.service';

const MAX_SNAPSHOT_BYTES = 100;

function buildCamera(overrides: Partial<Camera> = {}): Camera {
  return {
    id: 'camera-uuid',
    dvrId: 'dvr-uuid',
    externalId: 'channel-1',
    name: 'Front door',
    location: null,
    status: 'offline',
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

function buildCredentials(
  overrides: Partial<DvrCredentials> = {},
): DvrCredentials {
  return {
    id: 'dvr-uuid',
    spaceId: 'space-uuid',
    url: 'http://192.168.1.10:8000',
    username: 'admin',
    password: 'super-secret',
    timezone: 'America/Argentina/Buenos_Aires',
    lastTestAt: new Date('2026-01-01T00:00:00Z'),
    lastTestOk: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 'snapshot-uuid',
    cameraId: 'camera-uuid',
    data: Buffer.from('stored-bytes'),
    mimeType: 'image/jpeg',
    byteSize: 12,
    sha256: 'stored-hash',
    capturedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    isLive: false,
    ...overrides,
  };
}

const CAPTURED_AT = new Date('2026-02-01T08:00:00Z');

const IMAGE: CapturedImage = {
  data: Buffer.from('frame-bytes'),
  mimeType: 'image/jpeg',
  byteSize: 11,
  sha256: 'frame-hash',
  capturedAt: CAPTURED_AT,
};

describe('SnapshotService', () => {
  const spaceId = 'space-uuid';

  let snapshotAccessor: {
    create: jest.Mock;
    upsertLive: jest.Mock;
    findById: jest.Mock;
  };
  let cameraAccessor: { recordCaptureOutcome: jest.Mock };
  let dvrAccessor: { findCredentialsBySpaceId: jest.Mock };
  let dvrClient: { captureSnapshot: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let service: SnapshotService;

  beforeEach(() => {
    snapshotAccessor = {
      create: jest.fn(),
      upsertLive: jest.fn(),
      findById: jest.fn(),
    };
    cameraAccessor = { recordCaptureOutcome: jest.fn() };
    dvrAccessor = { findCredentialsBySpaceId: jest.fn() };
    dvrClient = { captureSnapshot: jest.fn() };
    configService = {
      getOrThrow: jest.fn().mockReturnValue(MAX_SNAPSHOT_BYTES),
    };
    service = new SnapshotService(
      snapshotAccessor as never,
      cameraAccessor as never,
      dvrAccessor as never,
      dvrClient as never,
      configService as never,
    );
  });

  describe('capture', () => {
    it('returns NOT_FOUND when the space has no DVR', async () => {
      dvrAccessor.findCredentialsBySpaceId.mockResolvedValue(null);

      const result = await service.capture(spaceId, buildCamera());

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
    });

    it('marks the camera offline and returns the client error when the fetch fails', async () => {
      dvrAccessor.findCredentialsBySpaceId.mockResolvedValue(
        buildCredentials(),
      );
      dvrClient.captureSnapshot.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_TIMEOUT, 'DVR snapshot fetch timed out'),
      );
      const camera = buildCamera();

      const result = await service.capture(spaceId, camera);

      expect(cameraAccessor.recordCaptureOutcome).toHaveBeenCalledWith(
        spaceId,
        camera.id,
        { status: CameraStatus.offline },
      );
      expect(result).toEqual({
        ok: false,
        code: ErrorCode.UPSTREAM_TIMEOUT,
        message: 'DVR snapshot fetch timed out',
      });
    });

    it('marks the camera online with the captured timestamp and returns the image', async () => {
      dvrAccessor.findCredentialsBySpaceId.mockResolvedValue(
        buildCredentials(),
      );
      dvrClient.captureSnapshot.mockResolvedValue(buildData(IMAGE));
      const camera = buildCamera();

      const result = await service.capture(spaceId, camera);

      expect(cameraAccessor.recordCaptureOutcome).toHaveBeenCalledWith(
        spaceId,
        camera.id,
        { status: CameraStatus.online, lastSnapshotAt: CAPTURED_AT },
      );
      expect(result).toEqual({ ok: true, data: IMAGE });
    });
  });

  describe('store', () => {
    it('rejects an image larger than the byte limit before calling the accessor', async () => {
      const oversized: CapturedImage = {
        ...IMAGE,
        byteSize: MAX_SNAPSHOT_BYTES + 1,
      };

      const result = await service.store(spaceId, 'camera-uuid', oversized);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(snapshotAccessor.create).not.toHaveBeenCalled();
    });

    it('rejects a non-image mime type before calling the accessor', async () => {
      const notAnImage: CapturedImage = {
        ...IMAGE,
        mimeType: 'application/pdf',
      };

      const result = await service.store(spaceId, 'camera-uuid', notAnImage);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(snapshotAccessor.create).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND when the camera is not in this space', async () => {
      snapshotAccessor.create.mockResolvedValue(null);

      const result = await service.store(spaceId, 'other-camera', IMAGE);

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
    });

    it('persists mime type, byte size, sha256 and capturedAt on success', async () => {
      const stored = buildSnapshot();
      snapshotAccessor.create.mockResolvedValue(stored);

      const result = await service.store(spaceId, 'camera-uuid', IMAGE);

      expect(snapshotAccessor.create).toHaveBeenCalledWith(
        spaceId,
        expect.objectContaining({
          cameraId: 'camera-uuid',
          mimeType: IMAGE.mimeType,
          byteSize: IMAGE.byteSize,
          sha256: IMAGE.sha256,
          capturedAt: IMAGE.capturedAt,
        }),
      );
      expect(result).toEqual({ ok: true, data: stored });
      expect(snapshotAccessor.upsertLive).not.toHaveBeenCalled();
    });

    it('overwrites the live row instead of creating one when isLive is set', async () => {
      const live = buildSnapshot({ isLive: true });
      snapshotAccessor.upsertLive.mockResolvedValue(live);

      const result = await service.store(spaceId, 'camera-uuid', IMAGE, true);

      expect(snapshotAccessor.upsertLive).toHaveBeenCalledWith(
        spaceId,
        expect.objectContaining({ cameraId: 'camera-uuid' }),
      );
      expect(snapshotAccessor.create).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, data: live });
    });
  });

  describe('captureAndStore', () => {
    it('writes the live row, so a button press cannot grow the table', async () => {
      const camera = buildCamera();
      dvrAccessor.findCredentialsBySpaceId.mockResolvedValue(
        buildCredentials(),
      );
      dvrClient.captureSnapshot.mockResolvedValue(buildData(IMAGE));
      snapshotAccessor.upsertLive.mockResolvedValue(
        buildSnapshot({ isLive: true }),
      );

      const result = await service.captureAndStore(spaceId, camera);

      expect(result.ok).toBe(true);
      expect(snapshotAccessor.upsertLive).toHaveBeenCalledTimes(1);
      expect(snapshotAccessor.create).not.toHaveBeenCalled();
    });
  });

  describe('read', () => {
    it('returns NOT_FOUND for an unknown id', async () => {
      snapshotAccessor.findById.mockResolvedValue(null);

      const result = await service.read(spaceId, 'missing-id');

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
    });

    it('returns the snapshot when it exists', async () => {
      const stored = buildSnapshot();
      snapshotAccessor.findById.mockResolvedValue(stored);

      const result = await service.read(spaceId, stored.id);

      expect(result).toEqual({ ok: true, data: stored });
    });
  });
});

describe('describeImage', () => {
  it('computes the sha256 hex digest and byte size of the given bytes', () => {
    const bytes = Buffer.from('hello world');

    const image = describeImage(bytes, 'image/png');

    expect(image.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(image.byteSize).toBe(bytes.byteLength);
    expect(image.mimeType).toBe('image/png');
  });
});
