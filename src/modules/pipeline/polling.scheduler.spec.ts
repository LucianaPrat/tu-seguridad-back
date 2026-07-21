import { buildData, buildError } from '../../cross/errors/either';
import { ErrorCode } from '../../cross/common/constants';
import { PollingScheduler } from './polling.scheduler';

describe('PollingScheduler', () => {
  const camera = {
    id: 'camera_01',
    enabled: true,
    snapshotUrl: 'http://dvr/snap.jpg',
    pollingIntervalSeconds: 5,
  };

  let configService: { get: jest.Mock };
  let cameraAccessor: { findAll: jest.Mock; findById: jest.Mock };
  let snapshotService: { fetch: jest.Mock };
  let pipelineService: { processImage: jest.Mock };
  let statusRegistry: { record: jest.Mock; incrementSkipped: jest.Mock };
  let schedulerRegistry: {
    addInterval: jest.Mock;
    deleteInterval: jest.Mock;
  };
  let scheduler: PollingScheduler;

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue(false) };
    cameraAccessor = {
      findAll: jest.fn().mockResolvedValue([camera]),
      findById: jest.fn().mockResolvedValue(camera),
    };
    snapshotService = { fetch: jest.fn() };
    pipelineService = { processImage: jest.fn() };
    statusRegistry = { record: jest.fn(), incrementSkipped: jest.fn() };
    schedulerRegistry = { addInterval: jest.fn(), deleteInterval: jest.fn() };
    scheduler = new PollingScheduler(
      configService as never,
      cameraAccessor as never,
      snapshotService as never,
      pipelineService as never,
      statusRegistry as never,
      schedulerRegistry as never,
    );
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    // Real per-camera setInterval handles are only known to the mocked
    // schedulerRegistry - clear them directly so the process can exit.
    for (const [, handle] of schedulerRegistry.addInterval.mock.calls as [
      string,
      NodeJS.Timeout,
    ][]) {
      clearInterval(handle);
    }
  });

  describe('onApplicationBootstrap', () => {
    it('registers no intervals when POLLING_ENABLED is false', async () => {
      await scheduler.onApplicationBootstrap();

      expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
    });

    it('registers one interval per enabled camera when POLLING_ENABLED is true', async () => {
      configService.get.mockReturnValue(true);

      await scheduler.onApplicationBootstrap();

      expect(schedulerRegistry.addInterval).toHaveBeenCalledTimes(1);
      expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
        'camera-poll:camera_01',
        expect.anything(),
      );
    });

    it('clears the sync timer on module destroy so no new ticks fire', async () => {
      configService.get.mockReturnValue(true);
      await scheduler.onApplicationBootstrap();

      const clearSpy = jest.spyOn(global, 'clearInterval');
      scheduler.onModuleDestroy();

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  describe('pollOnce', () => {
    it('skips a tick already in flight for the same camera and records the skip', async () => {
      let resolveFetch!: (value: unknown) => void;
      const pending = new Promise((resolve) => {
        resolveFetch = resolve;
      });
      snapshotService.fetch.mockReturnValue(pending);

      const firstPoll = scheduler.pollOnce('camera_01');
      await scheduler.pollOnce('camera_01');

      expect(statusRegistry.incrementSkipped).toHaveBeenCalledWith('camera_01');
      expect(snapshotService.fetch).toHaveBeenCalledTimes(1);

      resolveFetch(buildError(ErrorCode.UPSTREAM_ERROR, 'boom'));
      await firstPoll;
    });

    it('records an error status and skips processImage when the snapshot fetch fails', async () => {
      snapshotService.fetch.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_TIMEOUT, 'snapshot fetch timed out'),
      );

      await scheduler.pollOnce('camera_01');

      expect(pipelineService.processImage).not.toHaveBeenCalled();
      expect(statusRegistry.record).toHaveBeenCalledWith(
        'camera_01',
        expect.objectContaining({ lastErrorCode: ErrorCode.UPSTREAM_TIMEOUT }),
      );
    });

    it('calls processImage with the fetched snapshot on success', async () => {
      const buffer = Buffer.from('jpeg');
      snapshotService.fetch.mockResolvedValue(buildData(buffer));
      pipelineService.processImage.mockResolvedValue(buildData({}));

      await scheduler.pollOnce('camera_01');

      expect(pipelineService.processImage).toHaveBeenCalledWith(camera, buffer);
    });

    it('does nothing for an unknown or disabled camera', async () => {
      cameraAccessor.findById.mockResolvedValue(null);

      await scheduler.pollOnce('camera_missing');

      expect(snapshotService.fetch).not.toHaveBeenCalled();
    });

    it('allows a subsequent tick once the in-flight one completes', async () => {
      snapshotService.fetch.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_ERROR, 'x'),
      );

      await scheduler.pollOnce('camera_01');
      await scheduler.pollOnce('camera_01');

      expect(snapshotService.fetch).toHaveBeenCalledTimes(2);
      expect(statusRegistry.incrementSkipped).not.toHaveBeenCalled();
    });
  });
});
