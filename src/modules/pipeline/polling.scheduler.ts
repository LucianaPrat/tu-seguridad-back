import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Camera } from '@prisma/client';
import { EnvNames } from '../../cross/common/constants';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { DvrAccessorService } from '../../data/accessors/dvr.accessor';
import { CameraStatusRegistry } from '../cameras/camera-status.registry';
import { SnapshotService } from '../snapshots/snapshot.service';
import { PipelineService } from './pipeline.service';

const INTERVAL_NAME = 'camera-poll';

/**
 * Pulls a frame from every pollable camera on a fixed cadence.
 *
 * One interval for the whole process, not one per camera: cameras no longer
 * carry their own interval, and the work list changes as spaces configure their
 * recorders — a single tick that re-reads the list cannot go stale between
 * ticks the way a registry of per-camera timers does.
 */
@Injectable()
export class PollingScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PollingScheduler.name);
  private readonly inFlight = new Set<string>();
  private registered = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly dvrAccessor: DvrAccessorService,
    private readonly cameraAccessor: CameraAccessorService,
    private readonly snapshotService: SnapshotService,
    private readonly pipelineService: PipelineService,
    private readonly statusRegistry: CameraStatusRegistry,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.configService.get<boolean>(EnvNames.POLLING_ENABLED)) {
      this.logger.log('polling disabled');
      return;
    }

    const seconds = this.configService.getOrThrow<number>(
      EnvNames.POLLING_INTERVAL_SECONDS,
    );
    const handle = setInterval(() => {
      this.tick().catch((error: unknown) =>
        this.logger.error('polling tick failed', error),
      );
    }, seconds * 1000);
    this.schedulerRegistry.addInterval(INTERVAL_NAME, handle);
    this.registered = true;
    this.logger.log(`polling every ${seconds}s`);
  }

  onModuleDestroy(): void {
    if (this.registered) {
      this.schedulerRegistry.deleteInterval(INTERVAL_NAME);
      this.registered = false;
    }
    // In-flight polls are left to finish; only new ticks are stopped.
    this.logger.log('polling scheduler stopped, no new ticks will start');
  }

  /** One pass over every space that owns a recorder. Public so tests can drive it. */
  async tick(): Promise<void> {
    const spaceIds = await this.dvrAccessor.findSpaceIdsWithDvr();
    for (const spaceId of spaceIds) {
      const cameras = await this.cameraAccessor.findPollableBySpace(spaceId);
      for (const camera of cameras) {
        await this.pollOnce(spaceId, camera);
      }
    }
  }

  /**
   * One poll for one camera. A camera whose previous poll is still running is
   * counted as skipped rather than queued behind it: a slow recorder must not
   * build a backlog that outlives the condition causing it.
   */
  async pollOnce(spaceId: string, camera: Camera): Promise<void> {
    if (this.inFlight.has(camera.id)) {
      this.statusRegistry.incrementSkipped(camera.id);
      return;
    }

    this.inFlight.add(camera.id);
    try {
      const captured = await this.snapshotService.capture(spaceId, camera);
      if (!captured.ok) {
        this.statusRegistry.record(camera.id, {
          lastErrorAt: new Date(),
          lastErrorCode: captured.code,
        });
        return;
      }

      await this.pipelineService.processImage(spaceId, camera, captured.data);
    } finally {
      this.inFlight.delete(camera.id);
    }
  }
}
