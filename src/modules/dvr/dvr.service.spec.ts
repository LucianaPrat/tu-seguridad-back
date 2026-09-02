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
  let dvrClient: { discoverChannels: jest.Mock };
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
    dvrClient = { discoverChannels: jest.fn() };
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
});
