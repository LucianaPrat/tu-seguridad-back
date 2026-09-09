import { Camera } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError } from '../../cross/errors/either';
import { DvrDetails } from '../../data/accessors/dvr.accessor';
import { ConfigureDvrDto } from './dto/configure-dvr.dto';
import { TestDvrConnectionDto } from './dto/test-dvr-connection.dto';
import { DiscoveredChannel } from './dvr-client.port';
import { DvrService } from './dvr.service';

function buildDvr(overrides: Partial<DvrDetails> = {}): DvrDetails {
  return {
    id: 'dvr-uuid',
    spaceId: 'space-uuid',
    url: 'http://192.168.1.10:8000',
    username: 'admin',
    timezone: 'America/Argentina/Buenos_Aires',
    lastTestAt: new Date('2026-01-01T00:00:00Z'),
    lastTestOk: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildCamera(overrides: Partial<Camera> = {}): Camera {
  return {
    id: 'camera-uuid',
    dvrId: 'dvr-uuid',
    externalId: 'channel-1',
    name: 'Front door',
    location: null,
    status: 'offline',
    isConfigured: false,
    isEnabled: true,
    monitorMode: 'full',
    alertType: null,
    confidenceThreshold: null,
    minPollSeconds: null,
    lastSnapshotAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const CONFIGURE_DTO: ConfigureDvrDto = {
  url: 'http://192.168.1.10:8000',
  username: 'admin',
  password: 'super-secret',
  timezone: 'America/Argentina/Buenos_Aires',
};

const DISCOVERED_CHANNELS: DiscoveredChannel[] = [
  {
    externalId: 'channel-1',
    name: 'Front door',
    location: null,
    status: 'offline',
  },
];

describe('DvrService', () => {
  const spaceId = 'space-uuid';

  let dvrAccessor: {
    upsertConfiguration: jest.Mock;
    findBySpaceId: jest.Mock;
    findCredentialsBySpaceId: jest.Mock;
    recordTestResult: jest.Mock;
    reconcileDiscovery: jest.Mock;
  };
  let cameraAccessor: { countBySpace: jest.Mock };
  let dvrClient: { discoverChannels: jest.Mock; linkMotionEvents: jest.Mock };
  let service: DvrService;

  beforeEach(() => {
    dvrAccessor = {
      upsertConfiguration: jest.fn(),
      findBySpaceId: jest.fn(),
      findCredentialsBySpaceId: jest.fn(),
      recordTestResult: jest.fn(),
      reconcileDiscovery: jest.fn(),
    };
    cameraAccessor = { countBySpace: jest.fn() };
    dvrClient = { discoverChannels: jest.fn(), linkMotionEvents: jest.fn() };
    service = new DvrService(
      dvrAccessor as never,
      cameraAccessor as never,
      dvrClient as never,
    );
  });

  describe('configure', () => {
    it('rejects a URL with embedded credentials before discovery or persistence', async () => {
      const result = await service.configure(spaceId, {
        ...CONFIGURE_DTO,
        url: 'http://user:password@192.168.1.10:8000',
      });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(dvrClient.discoverChannels).not.toHaveBeenCalled();
      expect(dvrAccessor.upsertConfiguration).not.toHaveBeenCalled();
    });

    it('rejects an unknown IANA timezone without touching the accessor', async () => {
      const result = await service.configure(spaceId, {
        ...CONFIGURE_DTO,
        timezone: 'Not/AZone',
      });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(dvrClient.discoverChannels).not.toHaveBeenCalled();
      expect(dvrAccessor.upsertConfiguration).not.toHaveBeenCalled();
      expect(dvrAccessor.recordTestResult).not.toHaveBeenCalled();
    });

    it('returns the client error and never persists when discovery fails', async () => {
      dvrClient.discoverChannels.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_ERROR, 'DVR is unreachable'),
      );

      const result = await service.configure(spaceId, CONFIGURE_DTO);

      expect(result).toEqual({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
        message: 'DVR is unreachable',
      });
      expect(dvrAccessor.upsertConfiguration).not.toHaveBeenCalled();
      expect(dvrAccessor.recordTestResult).toHaveBeenCalledWith(spaceId, false);
    });

    it('persists, reconciles the discovered cameras and records success on a passwordless dto', async () => {
      dvrClient.discoverChannels.mockResolvedValue(
        buildData(DISCOVERED_CHANNELS),
      );
      const cameras = [
        buildCamera(),
        buildCamera({ id: 'camera-2', externalId: 'channel-2' }),
      ];
      dvrAccessor.reconcileDiscovery.mockResolvedValue(cameras);
      dvrAccessor.recordTestResult.mockResolvedValue(buildDvr());

      const result = await service.configure(spaceId, CONFIGURE_DTO);

      expect(dvrAccessor.upsertConfiguration).toHaveBeenCalledWith(spaceId, {
        url: CONFIGURE_DTO.url,
        username: CONFIGURE_DTO.username,
        password: CONFIGURE_DTO.password,
        timezone: CONFIGURE_DTO.timezone,
      });
      expect(dvrAccessor.reconcileDiscovery).toHaveBeenCalledWith(
        spaceId,
        DISCOVERED_CHANNELS,
      );
      expect(dvrAccessor.recordTestResult).toHaveBeenCalledWith(spaceId, true);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.cameraCount).toBe(cameras.length);
        expect(Object.keys(result.data)).not.toContain('password');
        expect(Object.keys(result.data)).not.toContain('passwordEncrypted');
      }
    });
  });

  describe('findBySpace', () => {
    it('returns NOT_FOUND when the space has no DVR', async () => {
      dvrAccessor.findBySpaceId.mockResolvedValue(null);

      const result = await service.findBySpace(spaceId);

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
    });

    it('reports cameraCount from the camera accessor', async () => {
      dvrAccessor.findBySpaceId.mockResolvedValue(buildDvr());
      cameraAccessor.countBySpace.mockResolvedValue(4);

      const result = await service.findBySpace(spaceId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.cameraCount).toBe(4);
      }
    });
  });

  describe('rediscover', () => {
    it('returns NOT_FOUND when no stored credentials exist', async () => {
      dvrAccessor.findCredentialsBySpaceId.mockResolvedValue(null);

      const result = await service.rediscover(spaceId);

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
    });

    it('records a failed test and returns the error on client failure', async () => {
      dvrAccessor.findCredentialsBySpaceId.mockResolvedValue({
        ...buildDvr(),
        password: 'super-secret',
      });
      dvrClient.discoverChannels.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_TIMEOUT, 'DVR timed out'),
      );

      const result = await service.rediscover(spaceId);

      expect(dvrAccessor.recordTestResult).toHaveBeenCalledWith(spaceId, false);
      expect(result).toEqual({
        ok: false,
        code: ErrorCode.UPSTREAM_TIMEOUT,
        message: 'DVR timed out',
      });
    });

    it('reconciles the discovered channels and returns the dto on success', async () => {
      dvrAccessor.findCredentialsBySpaceId.mockResolvedValue({
        ...buildDvr(),
        password: 'super-secret',
      });
      dvrClient.discoverChannels.mockResolvedValue(
        buildData(DISCOVERED_CHANNELS),
      );
      const cameras = [buildCamera()];
      dvrAccessor.reconcileDiscovery.mockResolvedValue(cameras);
      dvrAccessor.recordTestResult.mockResolvedValue(buildDvr());

      const result = await service.rediscover(spaceId);

      expect(dvrAccessor.reconcileDiscovery).toHaveBeenCalledWith(
        spaceId,
        DISCOVERED_CHANNELS,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.cameraCount).toBe(cameras.length);
      }
    });
  });

  describe('testConnection', () => {
    const PROBE_DTO: TestDvrConnectionDto = {
      url: 'http://192.168.1.10:8000',
      username: 'admin',
      password: 'super-secret',
    };

    it('rejects a URL with embedded credentials before reaching the recorder', async () => {
      const result = await service.testConnection({
        ...PROBE_DTO,
        url: 'http://user:password@192.168.1.10:8000',
      });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(dvrClient.discoverChannels).not.toHaveBeenCalled();
    });

    it('returns the client error without recording a failed test', async () => {
      dvrClient.discoverChannels.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_TIMEOUT, 'DVR timed out'),
      );

      const result = await service.testConnection(PROBE_DTO);

      expect(result).toEqual({
        ok: false,
        code: ErrorCode.UPSTREAM_TIMEOUT,
        message: 'DVR timed out',
      });
      expect(dvrAccessor.recordTestResult).not.toHaveBeenCalled();
      expect(dvrAccessor.upsertConfiguration).not.toHaveBeenCalled();
    });

    it('reports the channel count and stores nothing on success', async () => {
      dvrClient.discoverChannels.mockResolvedValue(
        buildData(DISCOVERED_CHANNELS),
      );

      const result = await service.testConnection(PROBE_DTO);

      expect(dvrClient.discoverChannels).toHaveBeenCalledWith(PROBE_DTO);
      expect(result).toEqual({
        ok: true,
        data: { channelCount: DISCOVERED_CHANNELS.length },
      });
      expect(dvrAccessor.upsertConfiguration).not.toHaveBeenCalled();
      expect(dvrAccessor.reconcileDiscovery).not.toHaveBeenCalled();
      expect(dvrAccessor.recordTestResult).not.toHaveBeenCalled();
    });
  });

  describe('linkEvents', () => {
    function withCredentials() {
      dvrAccessor.findCredentialsBySpaceId.mockResolvedValue({
        ...buildDvr(),
        password: 'super-secret',
      });
    }

    it('returns NOT_FOUND when no stored credentials exist, without calling the recorder', async () => {
      dvrAccessor.findCredentialsBySpaceId.mockResolvedValue(null);

      const result = await service.linkEvents(spaceId);

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
      expect(dvrClient.discoverChannels).not.toHaveBeenCalled();
      expect(dvrClient.linkMotionEvents).not.toHaveBeenCalled();
    });

    it('returns the discovery error verbatim and attempts no linkage', async () => {
      withCredentials();
      dvrClient.discoverChannels.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_TIMEOUT, 'DVR timed out'),
      );

      const result = await service.linkEvents(spaceId);

      expect(result).toEqual({
        ok: false,
        code: ErrorCode.UPSTREAM_TIMEOUT,
        message: 'DVR timed out',
      });
      expect(dvrClient.linkMotionEvents).not.toHaveBeenCalled();
    });

    it('reports linked, alreadyLinked and failed channels in discovery order', async () => {
      withCredentials();
      const channels: DiscoveredChannel[] = [
        { externalId: '1', name: 'Cam 1', location: null, status: 'online' },
        { externalId: '3', name: 'Cam 3', location: null, status: 'online' },
        { externalId: '4', name: 'Cam 4', location: null, status: 'offline' },
      ];
      dvrClient.discoverChannels.mockResolvedValue(buildData(channels));
      dvrClient.linkMotionEvents
        .mockResolvedValueOnce(buildData('linked'))
        .mockResolvedValueOnce(buildData('alreadyLinked'))
        .mockResolvedValueOnce(
          buildError(
            ErrorCode.VALIDATION_ERROR,
            'DVR channel is not a video input number',
          ),
        );

      const result = await service.linkEvents(spaceId);

      expect(result).toEqual({
        ok: true,
        data: {
          channels: [
            { externalId: '1', outcome: 'linked' },
            { externalId: '3', outcome: 'alreadyLinked' },
            {
              externalId: '4',
              outcome: 'failed',
              detail: 'DVR channel is not a video input number',
            },
          ],
        },
      });
    });

    it('returns UPSTREAM_ERROR when every channel fails', async () => {
      withCredentials();
      const channels: DiscoveredChannel[] = [
        { externalId: '1', name: 'Cam 1', location: null, status: 'online' },
        { externalId: '3', name: 'Cam 3', location: null, status: 'online' },
      ];
      dvrClient.discoverChannels.mockResolvedValue(buildData(channels));
      dvrClient.linkMotionEvents.mockResolvedValue(
        buildError(ErrorCode.UPSTREAM_ERROR, 'DVR event linkage failed'),
      );

      const result = await service.linkEvents(spaceId);

      expect(dvrClient.linkMotionEvents).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
        message: 'DVR accepted no event linkage on any channel',
      });
    });

    it('stops the loop on the first timeout and reports the rest as not attempted', async () => {
      withCredentials();
      const channels: DiscoveredChannel[] = Array.from(
        { length: 8 },
        (_, index) => ({
          externalId: String(index + 1),
          name: `Cam ${index + 1}`,
          location: null,
          status: 'online' as const,
        }),
      );
      dvrClient.discoverChannels.mockResolvedValue(buildData(channels));
      dvrClient.linkMotionEvents
        .mockResolvedValueOnce(buildData('linked'))
        .mockResolvedValueOnce(
          buildError(
            ErrorCode.UPSTREAM_TIMEOUT,
            'DVR event linkage for VMD-2 timed out',
          ),
        );

      const result = await service.linkEvents(spaceId);

      expect(dvrClient.linkMotionEvents).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.channels).toHaveLength(8);
        expect(result.data.channels[0]).toEqual({
          externalId: '1',
          outcome: 'linked',
        });
        expect(result.data.channels[1]).toEqual({
          externalId: '2',
          outcome: 'failed',
          detail: 'DVR event linkage for VMD-2 timed out',
        });
        for (const channel of result.data.channels.slice(2)) {
          expect(channel).toMatchObject({
            outcome: 'failed',
            detail: 'not attempted — the recorder stopped answering',
          });
        }
      }
    });
  });
});
