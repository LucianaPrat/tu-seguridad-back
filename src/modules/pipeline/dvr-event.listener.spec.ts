import { Camera, CameraStatus, MonitorMode } from '@prisma/client';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError } from '../../cross/errors/either';
import { DvrConnection, DvrEvent } from '../dvr/dvr-client.port';
import { DvrEventListener } from './dvr-event.listener';

function buildCamera(id: string, externalId: string): Camera {
  return {
    id,
    dvrId: 'dvr-uuid',
    externalId,
    name: `Camera ${externalId}`,
    location: null,
    status: CameraStatus.online,
    isConfigured: true,
    isEnabled: true,
    monitorMode: MonitorMode.full,
    alertType: null,
    confidenceThreshold: null,
    minPollSeconds: null,
    lastSnapshotAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const motion = (externalId: string): DvrEvent => ({
  kind: 'motion',
  externalId,
});
const keepalive: DvrEvent = { kind: 'keepalive' };

/** Long enough to drain any pending reconnect backoff on the fake clock. */
const RECONNECT_CEILING_MS = 60_000;

/** A notification to deliver, or something to do between two of them. */
type Step = DvrEvent | (() => void);

/**
 * A stream that plays its script, then stays open the way a real one does and
 * rejects on abort the way an aborted axios stream does. Staying open is what
 * keeps the supervisor parked instead of looping into its reconnect backoff,
 * so a test using this must end with `onModuleDestroy`.
 */
function openForever(signal: AbortSignal, ...steps: Step[]) {
  return (async function* () {
    for (const step of steps) {
      if (typeof step === 'function') {
        step();
        continue;
      }
      yield step;
    }
    await new Promise((_resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('canceled'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('canceled')));
    });
  })();
}

/** A stream that delivers and then ends, so the supervisor reaches its backoff. */
async function* closesAfter(...events: DvrEvent[]) {
  await Promise.resolve();
  yield* events;
}

describe(DvrEventListener.name, () => {
  const credentials = {
    url: 'http://dvr.local',
    username: 'admin',
    password: 'secret',
  };

  let config: Record<string, unknown>;
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };
  let dvrAccessor: {
    findSpaceIdsWithDvr: jest.Mock;
    findCredentialsBySpaceId: jest.Mock;
  };
  let cameraAccessor: { findPollableBySpace: jest.Mock };
  let dvrClient: { openEventStream: jest.Mock };
  let pollingScheduler: { pollGuarded: jest.Mock };
  let schedulerRegistry: { addInterval: jest.Mock; deleteInterval: jest.Mock };
  let intervals: NodeJS.Timeout[];
  let motionTotal: { inc: jest.Mock };
  let streamsActive: { inc: jest.Mock; dec: jest.Mock };
  let streamDrops: { inc: jest.Mock };
  let listener: DvrEventListener;

  /** Lets the detached supervisor run until it parks on the open stream. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  /** `mock.calls` is untyped; every read of a recorded call goes through here. */
  const opened = () =>
    dvrClient.openEventStream.mock.calls as [DvrConnection, AbortSignal][];
  const polled = () =>
    pollingScheduler.pollGuarded.mock.calls as [string, Camera][];

  beforeEach(() => {
    config = {
      [EnvNames.DVR_EVENTS_ENABLED]: true,
      [EnvNames.DVR_EVENTS_DEBOUNCE_SECONDS]: 5,
      [EnvNames.DVR_EVENTS_IDLE_SECONDS]: 30,
    };
    configService = {
      get: jest.fn((key: string) => config[key]),
      getOrThrow: jest.fn((key: string) => config[key]),
    };
    dvrAccessor = {
      findSpaceIdsWithDvr: jest.fn().mockResolvedValue(['space-a']),
      findCredentialsBySpaceId: jest.fn().mockResolvedValue(credentials),
    };
    cameraAccessor = {
      findPollableBySpace: jest
        .fn()
        .mockResolvedValue([
          buildCamera('camera-4', '4'),
          buildCamera('camera-7', '7'),
        ]),
    };
    dvrClient = { openEventStream: jest.fn() };
    pollingScheduler = { pollGuarded: jest.fn().mockResolvedValue(undefined) };
    intervals = [];
    // The real registry clears the handle it was given; a bare jest.fn() would
    // leave a live 60s interval behind and the suite would never exit.
    schedulerRegistry = {
      addInterval: jest.fn((_name: string, handle: NodeJS.Timeout) => {
        intervals.push(handle);
      }),
      deleteInterval: jest.fn(() => {
        intervals.forEach(clearInterval);
        intervals.length = 0;
      }),
    };
    motionTotal = { inc: jest.fn() };
    streamsActive = { inc: jest.fn(), dec: jest.fn() };
    streamDrops = { inc: jest.fn() };

    listener = new DvrEventListener(
      configService as never,
      dvrAccessor as never,
      cameraAccessor as never,
      dvrClient as never,
      pollingScheduler as never,
      schedulerRegistry as never,
      motionTotal as never,
      streamsActive as never,
      streamDrops as never,
    );
  });

  afterEach(async () => {
    listener.onModuleDestroy();
    intervals.forEach(clearInterval);
    // Lets each aborted supervisor run its `finally` before the next test.
    await settle();
    jest.restoreAllMocks();
  });

  /** Opens a stream that stays live and returns once the supervisor has parked. */
  async function connect(...steps: Step[]): Promise<void> {
    dvrClient.openEventStream.mockImplementation(
      (_connection: unknown, signal: AbortSignal) =>
        Promise.resolve(buildData(openForever(signal, ...steps))),
    );
    await listener.reconcile();
    await settle();
  }

  describe('lifecycle', () => {
    it('registers nothing and never reaches the recorder when disabled', () => {
      config[EnvNames.DVR_EVENTS_ENABLED] = false;

      listener.onApplicationBootstrap();

      expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
      expect(dvrClient.openEventStream).not.toHaveBeenCalled();
    });

    it('opens one stream per space carrying that space credentials', async () => {
      dvrAccessor.findSpaceIdsWithDvr.mockResolvedValue(['space-a', 'space-b']);

      await connect();

      expect(dvrClient.openEventStream).toHaveBeenCalledTimes(2);
      expect(opened()[0][0]).toEqual(credentials);
      expect(streamsActive.inc).toHaveBeenCalledTimes(2);
    });

    it('aborts the open streams and stops the interval on shutdown', async () => {
      await connect();
      listener.onApplicationBootstrap();
      const signal = opened()[0][1];

      listener.onModuleDestroy();

      expect(signal.aborted).toBe(true);
      expect(schedulerRegistry.deleteInterval).toHaveBeenCalledWith(
        'dvr-event-reconcile',
      );
    });

    it('skips a space whose credentials cannot be decrypted, and connects the rest', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      dvrAccessor.findSpaceIdsWithDvr.mockResolvedValue(['space-a', 'space-b']);
      dvrAccessor.findCredentialsBySpaceId.mockImplementation(
        (spaceId: string) =>
          spaceId === 'space-a'
            ? Promise.reject(new Error('Invalid encrypted field format'))
            : Promise.resolve(credentials),
      );

      await connect();

      expect(dvrClient.openEventStream).toHaveBeenCalledTimes(1);
    });

    it('counts a stream the recorder refused to open', async () => {
      // Fake timers because a refused open sends the supervisor straight into
      // its reconnect backoff, and a real one would keep the suite waiting.
      jest.useFakeTimers();
      try {
        dvrClient.openEventStream.mockResolvedValue(
          buildError(ErrorCode.UPSTREAM_ERROR, 'nope'),
        );

        await listener.reconcile();
        await jest.advanceTimersByTimeAsync(0);

        expect(streamsActive.inc).not.toHaveBeenCalled();
        expect(streamDrops.inc).toHaveBeenCalledWith({ reason: 'error' });
      } finally {
        listener.onModuleDestroy();
        await jest.advanceTimersByTimeAsync(RECONNECT_CEILING_MS);
        jest.useRealTimers();
      }
    });
  });

  describe('motion', () => {
    it('polls the camera whose externalId matches the channel', async () => {
      await connect(motion('4'));

      expect(pollingScheduler.pollGuarded).toHaveBeenCalledTimes(1);
      expect(pollingScheduler.pollGuarded).toHaveBeenCalledWith(
        'space-a',
        expect.objectContaining({ id: 'camera-4' }),
      );
      expect(motionTotal.inc).toHaveBeenCalledWith({
        channel: '4',
        outcome: 'triggered',
      });
    });

    it('never polls on a keepalive', async () => {
      await connect(keepalive, keepalive);

      expect(pollingScheduler.pollGuarded).not.toHaveBeenCalled();
    });

    it('collapses a burst on one camera into a single poll', async () => {
      // The recorder repeats `active` while motion lasts and never says it
      // ended: five pulses is one person walking past.
      await connect(motion('4'), motion('4'), motion('4'), motion('4'));

      expect(pollingScheduler.pollGuarded).toHaveBeenCalledTimes(1);
      expect(motionTotal.inc).toHaveBeenCalledWith({
        channel: '4',
        outcome: 'debounced',
      });
    });

    it('debounces per camera, so an interleaved channel still polls', async () => {
      await connect(motion('4'), motion('7'), motion('4'));

      expect(pollingScheduler.pollGuarded).toHaveBeenCalledTimes(2);
      expect(polled().map(([, camera]) => camera.id)).toEqual([
        'camera-4',
        'camera-7',
      ]);
    });

    it('polls again once the window has passed', async () => {
      const start = Date.now();
      const now = jest.spyOn(Date, 'now').mockReturnValue(start);

      await connect(
        motion('4'),
        () => now.mockReturnValue(start + 5000),
        motion('4'),
      );

      expect(pollingScheduler.pollGuarded).toHaveBeenCalledTimes(2);
    });

    it('raises the window to the camera own floor', async () => {
      // `minPollSeconds` is documented as only ever slowing a camera down, so
      // an event path that ignored it would turn an operator's 120 into 5.
      const camera = buildCamera('camera-4', '4');
      camera.minPollSeconds = 120;
      cameraAccessor.findPollableBySpace.mockResolvedValue([camera]);
      const start = Date.now();
      const now = jest.spyOn(Date, 'now').mockReturnValue(start);

      await connect(
        motion('4'),
        () => now.mockReturnValue(start + 60_000),
        motion('4'),
      );

      expect(pollingScheduler.pollGuarded).toHaveBeenCalledTimes(1);
      expect(motionTotal.inc).toHaveBeenCalledWith({
        channel: '4',
        outcome: 'debounced',
      });
    });

    it('keeps the stream alive when handling one notification throws', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      cameraAccessor.findPollableBySpace
        .mockRejectedValueOnce(new Error('database blip'))
        .mockResolvedValue([buildCamera('camera-7', '7')]);

      await connect(motion('4'), motion('7'));

      // The first notification is lost, the connection is not.
      expect(pollingScheduler.pollGuarded).toHaveBeenCalledTimes(1);
      expect(streamDrops.inc).not.toHaveBeenCalled();
    });

    it('counts a channel that matches no pollable camera', async () => {
      await connect(motion('2'));

      expect(pollingScheduler.pollGuarded).not.toHaveBeenCalled();
      expect(motionTotal.inc).toHaveBeenCalledWith({
        channel: '2',
        outcome: 'unmatched',
      });
    });

    it('keeps reading while a poll is still running', async () => {
      // The poll is fired and not awaited: a capture takes a second or two and
      // awaiting it would stop reading the socket.
      pollingScheduler.pollGuarded.mockReturnValue(new Promise(() => {}));

      await connect(motion('4'), motion('7'));

      expect(pollingScheduler.pollGuarded).toHaveBeenCalledTimes(2);
    });

    it('lets a forgotten camera poll immediately again', async () => {
      await connect(
        motion('4'),
        () => listener.forget('camera-4'),
        motion('4'),
      );

      expect(pollingScheduler.pollGuarded).toHaveBeenCalledTimes(2);
    });
  });

  describe('reconcile', () => {
    it('does not open a second connection for a space already streaming', async () => {
      await connect();

      await listener.reconcile();
      await settle();

      expect(dvrClient.openEventStream).toHaveBeenCalledTimes(1);
    });

    it('connects a space that appeared after the first pass', async () => {
      await connect();
      dvrAccessor.findSpaceIdsWithDvr.mockResolvedValue(['space-a', 'space-b']);

      await listener.reconcile();
      await settle();

      expect(dvrClient.openEventStream).toHaveBeenCalledTimes(2);
    });

    it('reconnects a recorder whose stored credentials changed', async () => {
      await connect();
      const signal = opened()[0][1];
      dvrAccessor.findCredentialsBySpaceId.mockResolvedValue({
        ...credentials,
        password: 'rotated',
      });

      await listener.reconcile();

      expect(signal.aborted).toBe(true);
    });

    it('disconnects a recorder whose credentials stopped decrypting', async () => {
      // The open socket is still authenticated with the password that key could
      // read, and nothing else would ever notice.
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await connect();
      const signal = opened()[0][1];
      dvrAccessor.findCredentialsBySpaceId.mockRejectedValue(
        new Error('Invalid encrypted field format'),
      );

      await listener.reconcile();

      expect(signal.aborted).toBe(true);
    });

    it('leaves a recorder alone when nothing about it changed', async () => {
      await connect();
      const signal = opened()[0][1];

      await listener.reconcile();

      expect(signal.aborted).toBe(false);
    });
  });

  describe('reconnection', () => {
    /**
     * Real timers on purpose: the backoff uses `node:timers/promises`, whose
     * `setTimeout` is captured at import and is not the global one jest fakes.
     * One base interval is the whole wait.
     */
    it('counts a stream that ended on its own and retries it', async () => {
      dvrClient.openEventStream
        .mockResolvedValueOnce(buildData(closesAfter(motion('4'))))
        .mockImplementation((_connection: unknown, signal: AbortSignal) =>
          Promise.resolve(buildData(openForever(signal))),
        );

      await listener.reconcile();
      await settle();
      expect(streamDrops.inc).toHaveBeenCalledWith({ reason: 'closed' });

      await new Promise((resolve) => setTimeout(resolve, 1300));

      expect(dvrClient.openEventStream).toHaveBeenCalledTimes(2);
    });
  });
});
