import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Camera, CameraStatus, Snapshot } from '@prisma/client';
import { createHash } from 'node:crypto';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { DvrAccessorService } from '../../data/accessors/dvr.accessor';
import { SnapshotAccessorService } from '../../data/accessors/snapshot.accessor';
import { CapturedImage, DvrClientPort } from '../dvr/dvr-client.port';

const NO_DVR_MESSAGE = 'This space has no DVR configured yet';

/** Turns bytes that arrived some other way (an upload) into a storable image. */
export function describeImage(
  data: Buffer,
  mimeType: string,
  capturedAt = new Date(),
): CapturedImage {
  return {
    data,
    mimeType,
    byteSize: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
    capturedAt,
  };
}

@Injectable()
export class SnapshotService {
  constructor(
    private readonly snapshotAccessor: SnapshotAccessorService,
    private readonly cameraAccessor: CameraAccessorService,
    private readonly dvrAccessor: DvrAccessorService,
    private readonly dvrClient: DvrClientPort,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Pulls the camera's current frame and records what the attempt says about
   * the camera: a frame means online plus a fresh `lastSnapshotAt`, a failure
   * means offline. Freshness is the age of the last frame the recorder handed
   * over, not of the last frame written to MySQL — those differ, and the UI
   * clock is about the recorder.
   */
  async capture(
    spaceId: string,
    camera: Camera,
  ): Promise<Either<CapturedImage>> {
    const credentials =
      await this.dvrAccessor.findCredentialsBySpaceId(spaceId);
    if (!credentials) {
      return buildError(ErrorCode.NOT_FOUND, NO_DVR_MESSAGE);
    }

    const captured = await this.dvrClient.captureSnapshot(
      {
        url: credentials.url,
        username: credentials.username,
        password: credentials.password,
      },
      camera.externalId,
    );
    if (!captured.ok) {
      await this.cameraAccessor.recordCaptureOutcome(spaceId, camera.id, {
        status: CameraStatus.offline,
      });
      return captured;
    }

    await this.cameraAccessor.recordCaptureOutcome(spaceId, camera.id, {
      status: CameraStatus.online,
      lastSnapshotAt: captured.data.capturedAt,
    });
    return captured;
  }

  /**
   * Writes the bytes to MySQL. The size ceiling is checked here as well as in
   * the DVR client because this path also takes uploads, and `MEDIUMBLOB`
   * rejects an oversized row with a driver error rather than a usable one.
   */
  async store(
    spaceId: string,
    cameraId: string,
    image: CapturedImage,
  ): Promise<Either<Snapshot>> {
    const maxBytes = this.configService.getOrThrow<number>(
      EnvNames.SNAPSHOT_MAX_BYTES,
    );
    if (image.byteSize > maxBytes) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        `Snapshot is larger than the ${maxBytes} byte limit`,
      );
    }
    if (!image.mimeType.startsWith('image/')) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        `${image.mimeType} is not an image`,
      );
    }

    const snapshot = await this.snapshotAccessor.create(spaceId, {
      cameraId,
      // Prisma's `Bytes` input is a plain `Uint8Array`; a `Buffer` is one too,
      // but carries a wider `ArrayBufferLike` and is rejected by the types.
      data: Uint8Array.from(image.data),
      mimeType: image.mimeType,
      byteSize: image.byteSize,
      sha256: image.sha256,
      capturedAt: image.capturedAt,
    });
    if (!snapshot) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${cameraId} not found`);
    }
    return buildData(snapshot);
  }

  async captureAndStore(
    spaceId: string,
    camera: Camera,
  ): Promise<Either<Snapshot>> {
    const captured = await this.capture(spaceId, camera);
    if (!captured.ok) {
      return captured;
    }
    return this.store(spaceId, camera.id, captured.data);
  }

  async read(spaceId: string, snapshotId: string): Promise<Either<Snapshot>> {
    const snapshot = await this.snapshotAccessor.findById(spaceId, snapshotId);
    if (!snapshot) {
      return buildError(
        ErrorCode.NOT_FOUND,
        `Snapshot ${snapshotId} not found`,
      );
    }
    return buildData(snapshot);
  }

  /** Latest stored frame per camera, for the derived `latestSnapshotUrl`. */
  findLatestIds(
    spaceId: string,
    cameraIds: string[],
  ): Promise<Map<string, string>> {
    return this.snapshotAccessor.findLatestIdsByCameraIds(spaceId, cameraIds);
  }
}
