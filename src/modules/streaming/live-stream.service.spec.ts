import { Camera } from '@prisma/client';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { JwtPayload } from '../../cross/common/jwt-payload.type';
import { buildData, buildError } from '../../cross/errors/either';
import { LiveStreamService } from './live-stream.service';

const camera = (overrides: Partial<Camera> = {}): Camera =>
  ({
    id: 'camera-uuid',
    dvrId: 'dvr-uuid',
    externalId: '3',
    name: 'Front door',
    location: null,
    status: 'online',
    isConfigured: true,
    isEnabled: true,
    monitorMode: 'full',
    alertType: 'intrusion',
    lastSnapshotAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Camera;

const claims: JwtPayload = {
  sub: 1,
  email: 'admin@example.com',
  spaceId: 'space-uuid',
  role: 'admin',
  profileCompleted: true,
};

describe('LiveStreamService', () => {
  let cameraAccessor: { findById: jest.Mock };
  let dvrAccessor: { findCredentialsBySpaceId: jest.Mock };
  let dvrClient: { streamUrl: jest.Mock };
  let publisher: { publish: jest.Mock };
  let jwtService: { verify: jest.Mock };
  let configService: { get: jest.Mock };
  let service: LiveStreamService;

  beforeEach(() => {
    cameraAccessor = { findById: jest.fn().mockResolvedValue(camera()) };
    dvrAccessor = {
      findCredentialsBySpaceId: jest.fn().mockResolvedValue({
        url: 'http://dvr.local',
        username: 'admin',
        password: 'secret',
      }),
    };
    dvrClient = {
      streamUrl: jest
        .fn()
        .mockReturnValue(
          buildData('rtsp://admin:secret@dvr.local:554/Streaming/Channels/302'),
        ),
    };
    publisher = {
      publish: jest.fn().mockResolvedValue(
        buildData({
          protocol: 'hls',
          url: 'http://media.local/camera-uuid/index.m3u8',
        }),
      ),
    };
    jwtService = { verify: jest.fn().mockReturnValue(claims) };
    configService = { get: jest.fn().mockReturnValue('jwt-secret') };
    service = new LiveStreamService(
      cameraAccessor as never,
      dvrAccessor as never,
      dvrClient as never,
      publisher,
      jwtService as never,
      configService as never,
    );
  });

  describe('start', () => {
    it('refuses before touching the database when streaming is off', async () => {
      configService.get.mockImplementation((name: string) =>
        name === EnvNames.MEDIAMTX_ENABLED ? false : 'jwt-secret',
      );

      const result = await service.start('space-uuid', 'camera-uuid');

      expect(result).toMatchObject({ ok: false, code: ErrorCode.CONFLICT });
      expect(cameraAccessor.findById).not.toHaveBeenCalled();
      expect(dvrAccessor.findCredentialsBySpaceId).not.toHaveBeenCalled();
    });

    it('publishes the camera under its own id and answers the playback url', async () => {
      const result = await service.start('space-uuid', 'camera-uuid');

      expect(result).toEqual(
        buildData({
          protocol: 'hls',
          url: 'http://media.local/camera-uuid/index.m3u8',
        }),
      );
      expect(publisher.publish).toHaveBeenCalledWith(
        'camera-uuid',
        'rtsp://admin:secret@dvr.local:554/Streaming/Channels/302',
      );
    });

    it('scopes the camera lookup to the caller space', async () => {
      await service.start('space-uuid', 'camera-uuid');
      expect(cameraAccessor.findById).toHaveBeenCalledWith(
        'space-uuid',
        'camera-uuid',
      );
    });

    it('answers 404 for a camera outside the caller space', async () => {
      cameraAccessor.findById.mockResolvedValue(null);

      const result = await service.start('space-uuid', 'other-space-camera');

      expect(result).toEqual({
        ok: false,
        code: ErrorCode.NOT_FOUND,
        message: 'Camera other-space-camera not found',
      });
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('refuses a disabled camera', async () => {
      cameraAccessor.findById.mockResolvedValue(camera({ isEnabled: false }));

      const result = await service.start('space-uuid', 'camera-uuid');

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ code: ErrorCode.CONFLICT });
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    // A camera with no monitor configuration is exactly the one an operator is
    // about to configure, and they need to see it to draw a zone on it.
    it('streams a camera that has no monitor configuration yet', async () => {
      cameraAccessor.findById.mockResolvedValue(
        camera({ isConfigured: false, alertType: null }),
      );

      const result = await service.start('space-uuid', 'camera-uuid');

      expect(result.ok).toBe(true);
    });

    it('answers 404 when the space owns no recorder', async () => {
      dvrAccessor.findCredentialsBySpaceId.mockResolvedValue(null);

      const result = await service.start('space-uuid', 'camera-uuid');

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.NOT_FOUND,
      });
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('passes an unbuildable stream url straight back', async () => {
      dvrClient.streamUrl.mockReturnValue(
        buildError(ErrorCode.VALIDATION_ERROR, 'DVR base URL cannot be parsed'),
      );

      const result = await service.start('space-uuid', 'camera-uuid');

      expect(result).toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('authorize', () => {
    const request = {
      action: 'read',
      path: 'camera-uuid',
      token: 'access-token',
      protocol: 'hls',
    };

    it('admits a reader whose token names the camera space', async () => {
      const result = await service.authorize(request);

      expect(result).toEqual(buildData({ authorized: true }));
      expect(cameraAccessor.findById).toHaveBeenCalledWith(
        'space-uuid',
        'camera-uuid',
      );
    });

    // A granted publish would let a caller push their own video into a camera
    // path, and the dashboard would render it as that camera's feed.
    it('refuses publish before it even looks at the token', async () => {
      const result = await service.authorize({ ...request, action: 'publish' });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.FORBIDDEN,
      });
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it('refuses a protocol it never handed out', async () => {
      const result = await service.authorize({ ...request, protocol: 'rtsp' });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.FORBIDDEN,
      });
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it('refuses a request with no token', async () => {
      const result = await service.authorize({
        action: 'read',
        path: 'camera-uuid',
      });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UNAUTHORIZED,
      });
    });

    it('refuses an invalid token', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('bad signature');
      });

      const result = await service.authorize(request);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UNAUTHORIZED,
      });
      expect(cameraAccessor.findById).not.toHaveBeenCalled();
    });

    it('refuses a refresh token presented as a reader credential', async () => {
      jwtService.verify.mockReturnValue({ ...claims, type: 'refresh' });

      const result = await service.authorize(request);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UNAUTHORIZED,
      });
    });

    // The global profile gate never runs here: the token arrives in a body, so
    // no guard sees it.
    it('refuses a caller with an incomplete profile', async () => {
      jwtService.verify.mockReturnValue({
        ...claims,
        profileCompleted: false,
      });

      const result = await service.authorize(request);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.FORBIDDEN,
      });
      expect(cameraAccessor.findById).not.toHaveBeenCalled();
    });

    it('refuses a path that names no camera in the token space', async () => {
      cameraAccessor.findById.mockResolvedValue(null);

      const result = await service.authorize({
        ...request,
        path: 'other-space-camera',
      });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.NOT_FOUND,
      });
    });

    it('refuses a disabled camera', async () => {
      cameraAccessor.findById.mockResolvedValue(camera({ isEnabled: false }));

      const result = await service.authorize(request);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.CONFLICT,
      });
    });

    // MediaMTX omits `protocol` on some actions; absent must not be a refusal.
    it('admits a reader when the media server sends no protocol', async () => {
      const result = await service.authorize({
        action: 'read',
        path: 'camera-uuid',
        token: 'access-token',
      });

      expect(result).toEqual(buildData({ authorized: true }));
    });

    // The token is still verified on every call; only the camera lookup is memoised.
    it('reads the camera once for a viewer segment storm', async () => {
      await service.authorize(request);
      await service.authorize(request);

      expect(cameraAccessor.findById).toHaveBeenCalledTimes(1);
    });
  });
});
