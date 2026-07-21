import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import { EnvNames } from '../../cross/common/constants';
import { MetricNames } from '../../cross/metrics/metric-names';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { CameraStatusRegistry } from '../cameras/camera-status.registry';
import { PipelineService } from './pipeline.service';
import { SnapshotService } from './snapshot.service';

const INTERVAL_PREFIX = 'camera-poll:';
const SYNC_INTERVAL_MS = 30_000;

@Injectable()
export class PollingScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PollingScheduler.name);
  private readonly inFlight = new Set<string>();
  private readonly registeredIntervalSeconds = new Map<string, number>();
  private syncTimer?: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly cameraAccessor: CameraAccessorService,
    private readonly snapshotService: SnapshotService,
    private readonly pipelineService: PipelineService,
    private readonly statusRegistry: CameraStatusRegistry,
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectMetric(MetricNames.PIPELINE_POLL_TOTAL)
    private readonly pollTotal: Counter<string>,
    @InjectMetric(MetricNames.PIPELINE_POLL_DURATION_SECONDS)
    private readonly pollDuration: Histogram<string>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const enabled = this.configService.get<boolean>(EnvNames.POLLING_ENABLED);
    if (!enabled) {
      this.logger.log('polling disabled');
      return;
    }

    await this.syncIntervals();
    this.syncTimer = setInterval(() => {
      this.syncIntervals().catch((error: unknown) =>
        this.logger.error('failed to sync polling intervals', error),
      );
    }, SYNC_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    // In-flight polls are left to finish; only new ticks are stopped.
    this.logger.log('polling scheduler stopped, no new ticks will start');
  }

  async syncIntervals(): Promise<void> {
    const cameras = await this.cameraAccessor.findAll();
    const enabledCameras = cameras.filter((camera) => camera.enabled);
    const desiredIds = new Set(enabledCameras.map((camera) => camera.id));

    for (const cameraId of this.registeredIntervalSeconds.keys()) {
      if (!desiredIds.has(cameraId)) {
        this.schedulerRegistry.deleteInterval(this.intervalName(cameraId));
        this.registeredIntervalSeconds.delete(cameraId);
      }
    }

    for (const camera of enabledCameras) {
      const registeredSeconds = this.registeredIntervalSeconds.get(camera.id);
      if (registeredSeconds === camera.pollingIntervalSeconds) {
        continue;
      }
      if (registeredSeconds !== undefined) {
        this.schedulerRegistry.deleteInterval(this.intervalName(camera.id));
      }

      const handle = setInterval(() => {
        this.pollOnce(camera.id).catch((error: unknown) =>
          this.logger.error(`poll failed for camera ${camera.id}`, error),
        );
      }, camera.pollingIntervalSeconds * 1000);
      this.schedulerRegistry.addInterval(this.intervalName(camera.id), handle);
      this.registeredIntervalSeconds.set(
        camera.id,
        camera.pollingIntervalSeconds,
      );
    }
  }

  /** One poll tick for a single camera; public so it can be tested directly. */
  async pollOnce(cameraId: string): Promise<void> {
    if (this.inFlight.has(cameraId)) {
      this.statusRegistry.incrementSkipped(cameraId);
      return;
    }

    this.inFlight.add(cameraId);
    const startedAt = Date.now();
    let status: 'success' | 'error' | undefined;
    try {
      const camera = await this.cameraAccessor.findById(cameraId);
      if (!camera || !camera.enabled) {
        return;
      }

      const snapshot = await this.snapshotService.fetch(camera);
      if (!snapshot.ok) {
        status = 'error';
        this.statusRegistry.record(cameraId, {
          lastErrorAt: new Date(),
          lastErrorCode: snapshot.code,
        });
        return;
      }

      await this.pipelineService.processImage(camera, snapshot.data);
      status = 'success';
    } finally {
      this.inFlight.delete(cameraId);
      if (status) {
        this.pollDuration.observe((Date.now() - startedAt) / 1000);
        this.pollTotal.inc({ status });
      }
    }
  }

  private intervalName(cameraId: string): string {
    return `${INTERVAL_PREFIX}${cameraId}`;
  }
}
