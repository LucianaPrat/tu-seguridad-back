import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Counter, Gauge } from 'prom-client';
import { EnvNames } from '../../cross/common/constants';
import { MetricNames } from '../../cross/metrics/metric-names';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { DvrAccessorService } from '../../data/accessors/dvr.accessor';
import { DvrClientPort, DvrConnection } from '../dvr/dvr-client.port';
import { PollingScheduler } from './polling.scheduler';

const RECONCILE_NAME = 'dvr-event-reconcile';

/**
 * How often the set of recorders is re-read. Not a knob: there is nothing a
 * host would tune it against, and `reconcile` is public so a spec drives it
 * directly rather than waiting on a timer.
 */
const RECONCILE_SECONDS = 60;

/**
 * Reconnect backoff, doubling to a ceiling. Not knobs either, and the reason is
 * stronger than "nobody tunes them": the poll is still running underneath at
 * `POLLING_PASSIVE_SECONDS`, so a stream that stays down delays an alert and
 * never loses one. Nothing about the timing is worth an operator's attention.
 *
 * No jitter. Jitter spreads a herd of clients hitting one server, and each
 * recorder has exactly one client here — `ecosystem.config.js` pins the API to
 * a single fork.
 *
 * ponytail: promote the backoff to a var the day a deployment is seen
 * reconnect-looping.
 */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

/** The doubling stops here; past it the ceiling applies anyway. */
const MAX_BACKOFF_EXPONENT = 6;

/** One recorder's live connection, and what it was opened with. */
interface OpenStream {
  controller: AbortController;
  /** Hash, never the credentials: a recorder repointed under us has to be noticed. */
  fingerprint: string;
}

/** Why a connection ended, as the drops counter reports it. */
type DropReason = 'idle' | 'error' | 'closed';

/**
 * Captures a frame when the recorder says something moved, instead of when a
 * clock says to look.
 *
 * The recorder is the second detector in this system and the only one watching
 * continuously: it classifies human and vehicle at the edge, on full-rate
 * video, while the poll samples a JPEG every few seconds. A person crosses a
 * street camera in three to eight seconds, which a fifteen-second grid can miss
 * outright — a different failure from the confidence tuning `plans/05` chased,
 * and not one a threshold can fix.
 *
 * This does not replace `PollingScheduler`, and deliberately so. The transport
 * has no acknowledgement, no replay, and a socket that dies without saying so;
 * a recorder rebooting at 03:00 stops publishing and reports nothing. The poll
 * stays on as a watchdog and bounds that failure.
 *
 * What it owns is the connection and the decision to fire. Everything after
 * that — the capture, detection, cadence, the live frame, the metrics — is
 * `pollGuarded`, unchanged and shared with the tick.
 */
@Injectable()
export class DvrEventListener
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DvrEventListener.name);

  /** One entry per recorder with a live or connecting supervisor. */
  private readonly streams = new Map<string, OpenStream>();

  /**
   * Earliest epoch-ms at which each camera may be polled by an event again.
   * Bounded by the camera count, and `forget` drops an entry when its camera
   * is deleted.
   */
  private readonly motionDueAt = new Map<string, number>();

  private stopping = false;
  private registered = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly dvrAccessor: DvrAccessorService,
    private readonly cameraAccessor: CameraAccessorService,
    private readonly dvrClient: DvrClientPort,
    private readonly pollingScheduler: PollingScheduler,
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectMetric(MetricNames.DVR_EVENT_MOTION_TOTAL)
    private readonly motionTotal: Counter<string>,
    @InjectMetric(MetricNames.DVR_EVENT_STREAMS_ACTIVE)
    private readonly streamsActive: Gauge<string>,
    @InjectMetric(MetricNames.DVR_EVENT_STREAM_DROPS_TOTAL)
    private readonly streamDrops: Counter<string>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.configService.get<boolean>(EnvNames.DVR_EVENTS_ENABLED)) {
      this.logger.log('dvr events disabled');
      return;
    }

    const handle = setInterval(() => {
      void this.reconcile();
    }, RECONCILE_SECONDS * 1000);
    this.schedulerRegistry.addInterval(RECONCILE_NAME, handle);
    this.registered = true;
    this.logger.log('dvr event listener started');
    void this.reconcile();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.registered) {
      this.schedulerRegistry.deleteInterval(RECONCILE_NAME);
      this.registered = false;
    }
    for (const stream of this.streams.values()) {
      stream.controller.abort();
    }
    // The supervisors are not awaited, the same posture the scheduler takes
    // with in-flight polls: each aborted read throws, sees `stopping` and
    // returns, and every pending backoff is unref'd so none of them can hold
    // the process open.
    this.logger.log('dvr event listener stopped');
  }

  /**
   * One pass over the recorders that should have a connection.
   *
   * There is no event bus in this repo, so a recorder configured or repointed
   * through `PUT /dvr` is noticed the same way `PollingScheduler.tick` notices
   * a new camera: by re-reading. A pass that re-reads cannot go stale the way a
   * subscription registered once at boot can.
   *
   * Public so a spec can drive it, exactly like `PollingScheduler.tick`.
   */
  async reconcile(): Promise<void> {
    if (this.stopping) {
      return;
    }

    for (const spaceId of await this.dvrAccessor.findSpaceIdsWithDvr()) {
      const current = this.streams.get(spaceId);
      if (!current) {
        // Claimed before the first await inside `supervise`, so two reconciles
        // overlapping cannot open two connections to one recorder.
        this.streams.set(spaceId, {
          controller: new AbortController(),
          fingerprint: '',
        });
        void this.supervise(spaceId);
        continue;
      }

      const credentials = await this.credentialsFor(spaceId);
      if (credentials && fingerprint(credentials) !== current.fingerprint) {
        this.logger.log(
          `dvr for space ${spaceId} was reconfigured, reconnecting`,
        );
        current.controller.abort();
      }
    }
  }

  /**
   * Drops the camera's motion window, so a channel that comes back is not
   * gated by the window of the camera that used to hold its id.
   */
  forget(cameraId: string): void {
    this.motionDueAt.delete(cameraId);
  }

  /**
   * One recorder's connection, for as long as the process lives.
   *
   * Detached and never joined, which is what keeps one dead recorder from
   * delaying any other: `reconcile` awaits a database read and a decrypt, never
   * a connection.
   */
  private async supervise(spaceId: string): Promise<void> {
    let attempt = 0;
    try {
      while (!this.stopping) {
        const credentials = await this.credentialsFor(spaceId);
        if (!credentials) {
          // Nothing to connect with. The next reconcile starts this over, so a
          // recorder whose row is unreadable costs one line a minute.
          return;
        }

        const controller = new AbortController();
        this.streams.set(spaceId, {
          controller,
          fingerprint: fingerprint(credentials),
        });
        if (this.stopping) {
          controller.abort();
          return;
        }

        const received = await this.consume(spaceId, credentials, controller);
        if (this.stopping) {
          return;
        }
        // Only a connection that delivered something counts as having worked.
        // One that opens and dies immediately is a failure however polite its
        // status code was, and must not reset the backoff.
        attempt = received ? 0 : attempt + 1;
        const wait = Math.min(
          RECONNECT_BASE_MS * 2 ** Math.min(attempt, MAX_BACKOFF_EXPONENT),
          RECONNECT_MAX_MS,
        );
        // Unref'd: a recorder that is switched off overnight must not hold the
        // process open for a minute at shutdown.
        await delay(wait, undefined, { ref: false });
      }
    } finally {
      this.streams.delete(spaceId);
    }
  }

  /**
   * Reads one connection to its end. Answers whether it delivered anything,
   * which is what the caller's backoff keys on.
   */
  private async consume(
    spaceId: string,
    connection: DvrConnection,
    controller: AbortController,
  ): Promise<boolean> {
    const idleMs =
      this.configService.getOrThrow<number>(EnvNames.DVR_EVENTS_IDLE_SECONDS) *
      1000;
    let outcome: DropReason = 'closed';
    let idle = false;
    let received = false;
    let counted = false;

    // Armed before the connect, not after, so one timer covers a TCP connect
    // that black-holes, headers that never arrive, and a socket that goes
    // quiet. That is also what lets the request itself carry no axios timeout.
    const watchdog = setTimeout(() => {
      idle = true;
      controller.abort();
    }, idleMs);
    // Unref'd for the same reason the reconnect backoff is: once everything
    // else has finished, a watchdog still counting down must not be the thing
    // keeping the process alive.
    watchdog.unref();

    try {
      const opened = await this.dvrClient.openEventStream(
        connection,
        controller.signal,
      );
      if (!opened.ok) {
        outcome = 'error';
        this.logger.warn(
          `dvr event stream for space ${spaceId} did not open: ${opened.code}`,
        );
        return false;
      }

      this.streamsActive.inc();
      counted = true;
      this.logger.log(`dvr event stream open for space ${spaceId}`);

      for await (const event of opened.data) {
        // Every part refreshes it, not only the heartbeat: the recorder pauses
        // its idle beat while it is busy reporting motion.
        watchdog.refresh();
        received = true;
        if (event.kind === 'motion') {
          await this.onMotion(spaceId, event.externalId);
        }
      }
      return received;
    } catch (error) {
      outcome = idle ? 'idle' : 'error';
      // The message only, never the error. An axios error carries the request
      // config and the config carries the recorder password.
      this.logger.warn(
        `dvr event stream for space ${spaceId} dropped (${outcome}): ` +
          (error instanceof Error ? error.message : 'unknown'),
      );
      return received;
    } finally {
      clearTimeout(watchdog);
      // Every path, so no socket is left holding a connection open.
      controller.abort();
      if (counted) {
        this.streamsActive.dec();
      }
      this.streamDrops.inc({ reason: outcome });
    }
  }

  /**
   * One motion notification, from channel to poll.
   *
   * The camera lookup is awaited here, inside the read loop, on purpose:
   * resolving it detached would put an await between the debounce check and its
   * stamp, and two pulses ten milliseconds apart would both pass — the exact
   * repetition the debounce exists to stop.
   *
   * The poll is the opposite, and is deliberately not awaited. A capture takes
   * one to two seconds, and awaiting it stops reading the socket, so the
   * recorder's next events would queue in the kernel buffer and arrive stale.
   * `pollGuarded` never rejects, and `pollOnce`'s own in-flight guard is what
   * keeps two polls of one camera from overlapping.
   */
  private async onMotion(spaceId: string, externalId: string): Promise<void> {
    // ponytail: one query per motion event. A per-space map with a TTL the day
    // an estate makes this hot; the poll tick re-reads the same list every 5s
    // today.
    const cameras = await this.cameraAccessor.findPollableBySpace(spaceId);
    const camera = cameras.find((one) => one.externalId === externalId);
    if (!camera) {
      this.motionTotal.inc({ channel: externalId, outcome: 'unmatched' });
      return;
    }

    // The scheduler's in-flight guard refuses overlap, not repetition. A
    // capture is one to two seconds and one person walking past produced five
    // pulses in under ten, so every one of them would find the slot free —
    // five captures and five detection POSTs for one person.
    const now = Date.now();
    if (now < (this.motionDueAt.get(camera.id) ?? 0)) {
      this.motionTotal.inc({ channel: externalId, outcome: 'debounced' });
      return;
    }
    // Stamped before anything can yield, for the reason in the doc comment.
    this.motionDueAt.set(
      camera.id,
      now +
        this.configService.getOrThrow<number>(
          EnvNames.DVR_EVENTS_DEBOUNCE_SECONDS,
        ) *
          1000,
    );
    this.motionTotal.inc({ channel: externalId, outcome: 'triggered' });
    void this.pollingScheduler.pollGuarded(spaceId, camera);
  }

  /**
   * The recorder's credentials, or nothing.
   *
   * `findCredentialsBySpaceId` decrypts, and decryption throws on a row this
   * key cannot read. The error is never logged: it carries the ciphertext.
   */
  private async credentialsFor(spaceId: string): Promise<DvrConnection | null> {
    try {
      const dvr = await this.dvrAccessor.findCredentialsBySpaceId(spaceId);
      return dvr
        ? { url: dvr.url, username: dvr.username, password: dvr.password }
        : null;
    } catch {
      this.logger.error(
        `dvr credentials for space ${spaceId} could not be read`,
      );
      return null;
    }
  }
}

/**
 * What a live connection was opened with, in a form safe to keep.
 *
 * Hashed rather than stored, because this sits in a map for the lifetime of the
 * process and a recorder password does not belong there. It only has to change
 * when the credentials change.
 */
function fingerprint(connection: DvrConnection): string {
  return createHash('sha256')
    .update(`${connection.url} ${connection.username} ${connection.password}`)
    .digest('hex');
}
