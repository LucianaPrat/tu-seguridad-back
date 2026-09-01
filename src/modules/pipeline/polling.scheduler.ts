import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Camera } from '@prisma/client';
import { Counter, Histogram } from 'prom-client';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { MetricNames } from '../../cross/metrics/metric-names';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { DvrAccessorService } from '../../data/accessors/dvr.accessor';
import { CameraStatusRegistry } from '../cameras/camera-status.registry';
import { withSpan } from '../../observability/tracing.helpers';
import { SnapshotService } from '../snapshots/snapshot.service';
import { AnalysisResult } from './analysis-result';
import { CadenceEngine } from './cadence.engine';
import { PipelineService } from './pipeline.service';

const INTERVAL_NAME = 'camera-poll';

/**
 * Pulls a frame from every pollable camera that is due for one.
 *
 * One interval for the whole process, not one per camera: cameras still carry
 * no timer of their own, and the work list changes as spaces configure their
 * recorders — a single tick that re-reads the list cannot go stale between
 * ticks the way a registry of per-camera timers does. What each camera does
 * carry is a cadence: the interval runs at the shortest rung of the ladder and
 * `CadenceEngine` decides, per camera, which ticks it actually sits out.
 */
@Injectable()
export class PollingScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PollingScheduler.name);
  private readonly inFlight = new Set<string>();
  // Absolute deadline per camera for the next live-frame write. An entry for a
  // camera that later disappears is one number and the map never grows past the
  // camera count, so nothing evicts them.
  private readonly liveWriteDueAt = new Map<string, number>();
  private registered = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly dvrAccessor: DvrAccessorService,
    private readonly cameraAccessor: CameraAccessorService,
    private readonly snapshotService: SnapshotService,
    private readonly pipelineService: PipelineService,
    private readonly statusRegistry: CameraStatusRegistry,
    private readonly cadenceEngine: CadenceEngine,
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectMetric(MetricNames.PIPELINE_POLL_TOTAL)
    private readonly pollTotal: Counter<string>,
    @InjectMetric(MetricNames.PIPELINE_POLL_DURATION_SECONDS)
    private readonly pollDuration: Histogram<string>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.configService.get<boolean>(EnvNames.POLLING_ENABLED)) {
      this.logger.log('polling disabled');
      return;
    }

    // The tick is the ladder's shortest rung, not a knob of its own: a separate
    // base-tick setting could only ever be configured out of step with the
    // cadences it is meant to serve.
    const seconds = this.cadenceEngine.tickSeconds;
    const handle = setInterval(() => {
      this.tick().catch((error: unknown) =>
        this.logger.error('polling tick failed', error),
      );
    }, seconds * 1000);
    this.schedulerRegistry.addInterval(INTERVAL_NAME, handle);
    this.registered = true;
    this.logger.log(`polling ticks every ${seconds}s, cameras poll on cadence`);
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
    const now = Date.now();
    const spaceIds = await this.dvrAccessor.findSpaceIdsWithDvr();
    for (const spaceId of spaceIds) {
      const cameras = await this.cameraAccessor.findPollableBySpace(spaceId);
      for (const camera of cameras) {
        // Cheapest thing in the loop, and deliberately first: a camera on the
        // passive cadence costs nothing on the ticks it sits out — no recorder
        // request, no detection call, no live-frame write.
        if (!this.cadenceEngine.isDue(camera.id, now)) {
          continue;
        }

        // One camera must not be able to end the tick. `pollOnce` maps every
        // failure it expects onto the camera's status, so anything reaching
        // here is unexpected — and letting it propagate would silently stop
        // monitoring every remaining camera and every remaining space.
        try {
          await this.pollOnce(spaceId, camera);
        } catch (error) {
          this.logger.error(
            `poll failed for camera ${camera.id}`,
            error instanceof Error ? error.stack : String(error),
          );
          this.statusRegistry.record(camera.id, {
            lastErrorAt: new Date(),
            lastErrorCode: ErrorCode.INTERNAL_ERROR,
          });
          // Same reason as every other failure path: a camera left un-armed is
          // due again on the very next tick.
          this.cadenceEngine.rearm(camera.id, Date.now());
        }
      }
    }
  }

  /**
   * One poll for one camera. A camera whose previous poll is still running is
   * counted as skipped rather than queued behind it: a slow recorder must not
   * build a backlog that outlives the condition causing it.
   *
   * Every path out re-arms the camera's cadence. A failed poll keeps the level
   * it already had — the frame said nothing about how fast to go, and dropping
   * a camera whose recorder is unreachable back onto the base tick would
   * hammer exactly the thing that is already struggling.
   */
  async pollOnce(spaceId: string, camera: Camera): Promise<void> {
    if (this.inFlight.has(camera.id)) {
      this.statusRegistry.incrementSkipped(camera.id);
      this.cadenceEngine.rearm(camera.id, Date.now());
      // Counted, but never timed: a skip did no work, and folding a zero into
      // the histogram would drag the percentiles of the polls that did toward
      // nothing. A camera skipping steadily is the signal that its cycle no
      // longer fits inside its cadence, which is what the counter is for.
      this.pollTotal.inc({ cameraId: camera.id, status: 'skipped' });
      return;
    }

    this.inFlight.add(camera.id);
    const startedAt = Date.now();
    // Pessimistic on purpose. Anything thrown past here is caught by `tick`,
    // which records INTERNAL_ERROR on the camera — so an unexpected failure
    // counts as an error instead of going uncounted.
    let status: 'success' | 'error' = 'error';
    try {
      await withSpan(
        'poll.camera',
        { cameraId: camera.id, spaceId },
        async () => {
          const captured = await this.snapshotService.capture(spaceId, camera);
          if (!captured.ok) {
            this.statusRegistry.record(camera.id, {
              lastErrorAt: new Date(),
              lastErrorCode: captured.code,
            });
            this.cadenceEngine.rearm(camera.id, Date.now());
            return;
          }

          const analysis = await this.pipelineService.processImage(
            spaceId,
            camera,
            captured.data,
          );
          if (analysis.ok) {
            this.applyCadence(camera.id, analysis.data);
          } else {
            this.cadenceEngine.rearm(camera.id, Date.now());
          }
          status = analysis.ok ? 'success' : 'error';

          // The poll refreshes the camera's live frame, so the grid has a
          // thumbnail and the zone editor a backdrop for a camera that never
          // alerted. One row per camera, overwritten in place: the alternative
          // was a BLOB per tick with no retention to clean it up.
          //
          // Written after detection, and its failure only recorded: a thumbnail
          // write must never suppress an alert, and a silent failure would show up
          // as a thumbnail that stops refreshing with nothing pointing at why.
          //
          // Throttled, because the row count being bounded never made the write
          // volume bounded: every tick rewrote the whole JPEG. The deadline only
          // moves on a write that succeeded, so a failed one is retried on the
          // next poll instead of being silenced for a whole window.
          //
          // ponytail: one window for every camera, whatever the frame showed. A
          // camera at the detection rung gets as stale a thumbnail as an idle
          // one; per-level windows only if the grid actually needs them.
          const writeSeconds = this.configService.getOrThrow<number>(
            EnvNames.SNAPSHOT_LIVE_WRITE_SECONDS,
          );
          const writeDueAt = this.liveWriteDueAt.get(camera.id) ?? 0;
          const writtenAt = Date.now();
          if (writeSeconds === 0 || writeDueAt <= writtenAt) {
            const live = await this.snapshotService.store(
              spaceId,
              camera.id,
              captured.data,
              true,
            );
            if (!live.ok) {
              this.statusRegistry.record(camera.id, {
                lastErrorAt: new Date(),
                lastErrorCode: live.code,
              });
            } else {
              this.liveWriteDueAt.set(
                camera.id,
                writtenAt + writeSeconds * 1000,
              );
            }
          }
        },
      );
    } finally {
      this.inFlight.delete(camera.id);
      // Timed around the whole poll, recorder request included, which is what
      // `CameraStatusRegistry.lastLatencyMs` never covered: that one starts
      // after the frame is already in hand. A failed live-frame write leaves
      // this a success — the poll detected, and the thumbnail is recorded on
      // the camera's own status.
      this.pollDuration.observe(
        { cameraId: camera.id },
        (Date.now() - startedAt) / 1000,
      );
      this.pollTotal.inc({ cameraId: camera.id, status });
    }
  }

  /**
   * Re-arms the camera from the frame it just produced and publishes where it
   * landed. Logged only when the level actually moved: one line per real
   * transition is readable, one per poll is not.
   */
  private applyCadence(cameraId: string, analysis: AnalysisResult): void {
    const { level, seconds, changed } = this.cadenceEngine.record(
      cameraId,
      analysis,
      Date.now(),
    );
    this.statusRegistry.record(cameraId, {
      pollLevel: level,
      pollIntervalSeconds: seconds,
    });
    if (changed) {
      this.logger.log(
        `camera ${cameraId} now polling ${level} every ${seconds}s`,
      );
    }
  }
}
