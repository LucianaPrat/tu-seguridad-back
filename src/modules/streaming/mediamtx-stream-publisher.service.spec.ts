import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { MediaMtxStreamPublisherService } from './mediamtx-stream-publisher.service';

const SOURCE = 'rtsp://admin:s3cr3t@dvr.local:554/Streaming/Channels/302';

describe('MediaMtxStreamPublisherService', () => {
  let httpService: { post: jest.Mock };
  let config: Record<string, unknown>;
  let service: MediaMtxStreamPublisherService;

  beforeEach(() => {
    httpService = { post: jest.fn().mockReturnValue(of({ status: 200 })) };
    config = {
      [EnvNames.MEDIAMTX_ENABLED]: true,
      [EnvNames.MEDIAMTX_API_URL]: 'http://127.0.0.1:9997',
      [EnvNames.MEDIAMTX_PUBLIC_URL]: 'http://media.local:8888',
      [EnvNames.MEDIAMTX_TIMEOUT_MS]: 5000,
    };
    service = new MediaMtxStreamPublisherService(
      httpService as never,
      {
        get: (name: string) => config[name],
      } as never,
    );
  });

  it('registers an on-demand path and answers its hls url', async () => {
    const result = await service.publish('camera-uuid', SOURCE);

    expect(result).toEqual({
      ok: true,
      data: {
        protocol: 'hls',
        url: 'http://media.local:8888/camera-uuid/index.m3u8',
      },
    });
    expect(httpService.post).toHaveBeenCalledWith(
      'http://127.0.0.1:9997/v3/config/paths/replace/camera-uuid',
      {
        source: SOURCE,
        sourceOnDemand: true,
        sourceOnDemandCloseAfter: '10s',
      },
      { timeout: 5000 },
    );
  });

  // `add` fails on an existing path, and the second viewer of a camera is the
  // normal case rather than an error.
  it('uses replace so a second viewer is not a conflict', async () => {
    await service.publish('camera-uuid', SOURCE);
    await service.publish('camera-uuid', SOURCE);

    const urls = (httpService.post.mock.calls as [string][]).map(
      ([url]) => url,
    );
    expect(urls[0]).toContain('/v3/config/paths/replace/');
    expect(urls[1]).toBe(urls[0]);
  });

  it('refuses without ever calling the media server when streaming is off', async () => {
    config[EnvNames.MEDIAMTX_ENABLED] = false;

    const result = await service.publish('camera-uuid', SOURCE);

    expect(result).toMatchObject({ ok: false, code: ErrorCode.CONFLICT });
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('maps a timeout to UPSTREAM_TIMEOUT', async () => {
    httpService.post.mockReturnValue(
      throwError(() => {
        const error = new AxiosError('timeout of 5000ms exceeded');
        error.code = 'ECONNABORTED';
        return error;
      }),
    );

    const result = await service.publish('camera-uuid', SOURCE);

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_TIMEOUT,
    });
  });

  it('maps a refused registration to UPSTREAM_ERROR carrying the status', async () => {
    httpService.post.mockReturnValue(
      throwError(() => {
        const error = new AxiosError('Request failed');
        error.response = { status: 400 } as never;
        return error;
      }),
    );

    const result = await service.publish('camera-uuid', SOURCE);

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_ERROR,
      message: 'Stream publish failed (status 400)',
    });
  });

  // The axios error carries the request body it was sent with, and that body
  // holds the recorder password in `source`.
  it('never puts the source url in the error it returns', async () => {
    httpService.post.mockReturnValue(
      throwError(() => {
        const error = new AxiosError('Request failed');
        error.config = { data: JSON.stringify({ source: SOURCE }) } as never;
        error.response = { status: 500 } as never;
        return error;
      }),
    );

    const result = await service.publish('camera-uuid', SOURCE);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('s3cr3t');
  });

  it('does not treat a non-axios failure as reachable', async () => {
    httpService.post.mockReturnValue(
      throwError(() => new Error('something else')),
    );

    const result = await service.publish('camera-uuid', SOURCE);

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_ERROR,
      message: 'Stream publish failed',
    });
  });
});
