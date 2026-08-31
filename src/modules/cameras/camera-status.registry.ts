import { Injectable } from '@nestjs/common';
import { AlertType } from '@prisma/client';
import { CadenceLevel } from '../pipeline/cadence.engine';

export interface ZoneOccupancySnapshot {
  /** `null` on a full-frame camera: the whole image is the monitored area. */
  zoneId: string | null;
  alertType: AlertType;
  occupied: boolean;
}

export interface CameraPipelineStatus {
  cameraId: string;
  lastPolledAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
  lastLatencyMs: number | null;
  lastPersonsDetected: boolean | null;
  skippedPolls: number;
  /** Which rung of the poll cadence ladder this camera is currently on. */
  pollLevel: CadenceLevel | null;
  pollIntervalSeconds: number | null;
  zones: ZoneOccupancySnapshot[];
}

const EMPTY_STATUS = (cameraId: string): CameraPipelineStatus => ({
  cameraId,
  lastPolledAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorCode: null,
  lastLatencyMs: null,
  lastPersonsDetected: null,
  skippedPolls: 0,
  pollLevel: null,
  pollIntervalSeconds: null,
  zones: [],
});

/**
 * In-memory pipeline status per camera. Deliberately not persisted: it is what
 * this process has seen since boot, and `cameras.status` / `last_snapshot_at`
 * are the durable version of the same question.
 */
@Injectable()
export class CameraStatusRegistry {
  private readonly statuses = new Map<string, CameraPipelineStatus>();

  get(cameraId: string): CameraPipelineStatus {
    return this.statuses.get(cameraId) ?? EMPTY_STATUS(cameraId);
  }

  record(
    cameraId: string,
    patch: Partial<Omit<CameraPipelineStatus, 'cameraId'>>,
  ): void {
    this.statuses.set(cameraId, { ...this.get(cameraId), ...patch });
  }

  incrementSkipped(cameraId: string): void {
    const current = this.get(cameraId);
    this.statuses.set(cameraId, {
      ...current,
      skippedPolls: current.skippedPolls + 1,
    });
  }
}
