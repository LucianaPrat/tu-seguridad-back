import { Injectable } from '@nestjs/common';

export interface CameraStatus {
  cameraId: string;
  lastPolledAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
  lastLatencyMs: number | null;
  lastPersonsDetected: boolean | null;
}

/**
 * In-memory pipeline status per camera. Always empty (all nulls) until T16
 * wires the polling scheduler and starts recording poll outcomes.
 */
@Injectable()
export class CameraStatusRegistry {
  private readonly statuses = new Map<string, CameraStatus>();

  get(cameraId: string): CameraStatus {
    return (
      this.statuses.get(cameraId) ?? {
        cameraId,
        lastPolledAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorCode: null,
        lastLatencyMs: null,
        lastPersonsDetected: null,
      }
    );
  }
}
