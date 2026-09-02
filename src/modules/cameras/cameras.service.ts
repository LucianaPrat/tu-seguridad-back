import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlertType, MonitorMode } from '@prisma/client';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { AnalysisResult } from '../pipeline/analysis-result';
import { PipelineService } from '../pipeline/pipeline.service';
import { PollingScheduler } from '../pipeline/polling.scheduler';
import { SnapshotDto } from '../snapshots/dto/snapshot.dto';
import { describeImage, SnapshotService } from '../snapshots/snapshot.service';
import { toSnapshotDto } from '../snapshots/snapshot.mapper';
import { LiveStreamService } from '../streaming/live-stream.service';
import {
  CameraPipelineStatus,
  CameraStatusRegistry,
} from './camera-status.registry';
import { toCameraDto } from './camera.mapper';
import { CameraDto } from './dto/camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';

@Injectable()
export class CamerasService {
  constructor(
    private readonly cameraAccessor: CameraAccessorService,
    private readonly snapshotService: SnapshotService,
    private readonly statusRegistry: CameraStatusRegistry,
    private readonly pipelineService: PipelineService,
    private readonly configService: ConfigService,
    private readonly pollingScheduler: PollingScheduler,
    private readonly liveStreamService: LiveStreamService,
  ) {}

  async findAll(spaceId: string): Promise<Either<CameraDto[]>> {
    const cameras = await this.cameraAccessor.findAll(spaceId);
    const latestSnapshotIds = await this.snapshotService.findLatestIds(
      spaceId,
      cameras.map((camera) => camera.id),
    );
    return buildData(
      cameras.map((camera) =>
        toCameraDto(camera, latestSnapshotIds.get(camera.id)),
      ),
    );
  }

  async findById(spaceId: string, id: string): Promise<Either<CameraDto>> {
    const camera = await this.cameraAccessor.findById(spaceId, id);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }
    const latestSnapshotIds = await this.snapshotService.findLatestIds(
      spaceId,
      [camera.id],
    );
    return buildData(toCameraDto(camera, latestSnapshotIds.get(camera.id)));
  }

  /**
   * Saving monitor behavior is what makes a camera configured, and the rule
   * differs per mode: a full-frame camera needs its own alert level, a partial
   * one needs at least one zone to evaluate. A camera that satisfies neither is
   * left unconfigured rather than half-armed — the poll query skips it, so the
   * operator sees an unmonitored camera instead of a silent one.
   */
  async update(
    spaceId: string,
    id: string,
    dto: UpdateCameraDto,
  ): Promise<Either<CameraDto>> {
    const camera = await this.cameraAccessor.findById(spaceId, id);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }

    const monitorMode = dto.monitorMode ?? camera.monitorMode;
    const alertType = dto.alertType ?? camera.alertType;
    if (monitorMode === MonitorMode.full && !alertType) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        'A full-frame camera needs an alertType',
      );
    }

    // Refused rather than clamped. A floor under the ladder's fastest rung
    // would be accepted and then do nothing, and an operator who set 2 where
    // the ladder already polls at 5 deserves to be told, not ignored.
    const basePollSeconds = this.pipelineService.basePollSeconds;
    if (
      dto.minPollSeconds !== undefined &&
      dto.minPollSeconds !== null &&
      dto.minPollSeconds < basePollSeconds
    ) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        `minPollSeconds must be at least ${basePollSeconds}, the shortest interval the scheduler runs at`,
      );
    }

    const isConfigured = await this.resolveIsConfigured(
      spaceId,
      camera.id,
      monitorMode,
      alertType,
    );
    const updated = await this.cameraAccessor.update(spaceId, id, {
      name: dto.name,
      location: dto.location,
      isEnabled: dto.isEnabled,
      monitorMode,
      alertType,
      isConfigured,
      confidenceThreshold: dto.confidenceThreshold,
      minPollSeconds: dto.minPollSeconds,
    });
    if (!updated) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }
    if (monitorMode !== camera.monitorMode || alertType !== camera.alertType) {
      this.pipelineService.resetCameraState(camera.id);
    }
    return buildData(toCameraDto(updated));
  }

  /**
   * Logical delete. The camera disappears from every normal read and from
   * polling, while the alert history that references it keeps its own label and
   * alert level — deleting a camera must not rewrite what already happened.
   */
  /**
   * The row is deleted logically; what the process remembers about the camera
   * is not, so it is dropped here, explicitly, one call per holder.
   *
   * An explicit list rather than an event: five holders, one place, and the
   * only way to notice a sixth was added is to read them together. Not a memory
   * concern — every one of these maps is bounded by the camera count. It is
   * that a camera id can come back, because the recorder rediscovers a channel
   * that was deleted and reconfigured, and it must not inherit the occupancy
   * streak, cadence, error status, live-frame deadline or stream path of the
   * camera that used to hold it.
   */
  async delete(spaceId: string, id: string): Promise<Either<null>> {
    const deleted = await this.cameraAccessor.softDelete(spaceId, id);
    if (!deleted) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }

    this.pipelineService.resetCameraState(id);
    this.statusRegistry.forget(id);
    this.pollingScheduler.forget(id);
    // Last, and awaited only so its own failure is logged: it reaches the media
    // server, and the camera is gone from the API whether or not that answers.
    await this.liveStreamService.forget(spaceId, id);

    return buildData(null);
  }

  async getStatus(
    spaceId: string,
    id: string,
  ): Promise<Either<CameraPipelineStatus>> {
    const camera = await this.cameraAccessor.findById(spaceId, id);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }
    return buildData(this.statusRegistry.get(id));
  }

  /** Pulls a frame from the recorder now and stores it. */
  async capture(spaceId: string, id: string): Promise<Either<SnapshotDto>> {
    const camera = await this.cameraAccessor.findById(spaceId, id);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }

    const stored = await this.snapshotService.captureAndStore(spaceId, camera);
    if (!stored.ok) {
      return stored;
    }
    return buildData(toSnapshotDto(stored.data));
  }

  /**
   * Manual detection run against an uploaded image — the path that still works
   * when the recorder is unreachable.
   */
  async analyze(
    spaceId: string,
    id: string,
    image: Buffer,
    mimeType: string,
  ): Promise<Either<AnalysisResult>> {
    const maxBytes = this.configService.getOrThrow<number>(
      EnvNames.SNAPSHOT_MAX_BYTES,
    );
    if (image.byteLength > maxBytes) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        `Image is larger than the ${maxBytes} byte limit`,
      );
    }

    const camera = await this.cameraAccessor.findById(spaceId, id);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }
    return this.pipelineService.processImage(
      spaceId,
      camera,
      describeImage(image, mimeType),
    );
  }

  private async resolveIsConfigured(
    spaceId: string,
    cameraId: string,
    monitorMode: MonitorMode,
    alertType: AlertType | null,
  ): Promise<boolean> {
    if (monitorMode === MonitorMode.full) {
      return alertType !== null;
    }
    const zoneCount = await this.cameraAccessor.countMonitorZones(
      spaceId,
      cameraId,
    );
    return zoneCount > 0;
  }
}
