import { Injectable } from '@nestjs/common';

export interface ZoneOccupancySnapshot {
  zoneId: string;
  occupied: boolean;
}

export interface CameraStatus {
  cameraId: string;
  lastPolledAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
  lastLatencyMs: number | null;
  lastPersonsDetected: boolean | null;
  skippedPolls: number;
  zones: ZoneOccupancySnapshot[];
}

const EMPTY_STATUS = (cameraId: string): CameraStatus => ({
  cameraId,
  lastPolledAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorCode: null,
  lastLatencyMs: null,
  lastPersonsDetected: null,
  skippedPolls: 0,
  zones: [],
});

/**
 * In-memory pipeline status per camera. All nulls until the polling
 * scheduler / manual analyze (T16) starts recording poll outcomes.
 */
@Injectable()
export class CameraStatusRegistry {
  private readonly statuses = new Map<string, CameraStatus>();

  get(cameraId: string): CameraStatus {
    return this.statuses.get(cameraId) ?? EMPTY_STATUS(cameraId);
  }

  record(
    cameraId: string,
    patch: Partial<Omit<CameraStatus, 'cameraId'>>,
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
