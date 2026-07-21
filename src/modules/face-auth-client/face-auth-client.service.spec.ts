import { AxiosError, AxiosHeaders } from 'axios';
import { of, throwError } from 'rxjs';
import { ErrorCode } from '../../cross/common/constants';
import { FaceAuthClientService } from './face-auth-client.service';

const SECRET_TOKEN = 'super-secret-fa-token-do-not-leak';

describe('FaceAuthClientService', () => {
  let httpService: { post: jest.Mock };
  let configService: { get: jest.Mock };
  let service: FaceAuthClientService;

  beforeEach(() => {
    httpService = { post: jest.fn() };
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string | number> = {
          FACE_AUTH_API_URL: 'https://api.face-auth.me',
          FACE_AUTH_DOMAIN: 'test-domain',
          FACE_AUTH_TOKEN: SECRET_TOKEN,
          DETECT_TIMEOUT_MS: 10000,
        };
        return values[key];
      }),
    };
    service = new FaceAuthClientService(
      httpService as never,
      configService as never,
    );
  });

  function axiosError(overrides: Partial<AxiosError>): AxiosError {
    const error = new AxiosError(
      overrides.message ?? 'Request failed',
      overrides.code,
      undefined,
      undefined,
      overrides.response as never,
    );
    return Object.assign(error, overrides);
  }

  it('maps a successful response to buildData', async () => {
    const payload = {
      personsDetected: true,
      imageWidth: 1280,
      imageHeight: 720,
      persons: [
        {
          detScore: 0.91,
          bbox: {
            topLeft: { x: 417, y: 163 },
            bottomRight: { x: 596, y: 682 },
          },
          bboxNorm: {
            topLeft: { x: 0.32, y: 0.22 },
            bottomRight: { x: 0.46, y: 0.94 },
          },
          anchor: { x: 0.396, y: 0.947 },
        },
      ],
    };
    httpService.post.mockReturnValue(of({ data: payload }));

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toEqual({ ok: true, data: payload });
  });

  it('sends Fa-Domain/Fa-Token headers and the multipart file field', async () => {
    httpService.post.mockReturnValue(
      of({
        data: {
          personsDetected: false,
          imageWidth: 0,
          imageHeight: 0,
          persons: [],
        },
      }),
    );

    await service.detectPersons(Buffer.from('img'), 'a.jpg');

    const [, , options] = httpService.post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string>; timeout: number },
    ];
    expect(options.headers['Fa-Domain']).toBe('test-domain');
    expect(options.headers['Fa-Token']).toBe(SECRET_TOKEN);
    expect(options.timeout).toBe(10000);
  });

  it('maps a timeout to UPSTREAM_TIMEOUT without leaking the token', async () => {
    httpService.post.mockReturnValue(
      throwError(() =>
        axiosError({
          code: 'ECONNABORTED',
          message: 'timeout of 10000ms exceeded',
        }),
      ),
    );

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_TIMEOUT,
    });
    if (!result.ok) {
      expect(result.message).not.toContain(SECRET_TOKEN);
    }
  });

  it('maps a 500 to UPSTREAM_ERROR without leaking the token', async () => {
    httpService.post.mockReturnValue(
      throwError(() =>
        axiosError({
          message: 'Request failed with status code 500',
          response: {
            status: 500,
            statusText: 'Internal Server Error',
            data: {},
            headers: new AxiosHeaders(),
            config: { headers: new AxiosHeaders() } as never,
          },
        }),
      ),
    );

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
    if (!result.ok) {
      expect(result.message).toContain('500');
      expect(result.message).not.toContain(SECRET_TOKEN);
    }
  });

  it('maps a 429 to UPSTREAM_ERROR without leaking the token', async () => {
    httpService.post.mockReturnValue(
      throwError(() =>
        axiosError({
          message: 'Request failed with status code 429',
          response: {
            status: 429,
            statusText: 'Too Many Requests',
            data: {},
            headers: new AxiosHeaders(),
            config: { headers: new AxiosHeaders() } as never,
          },
        }),
      ),
    );

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
    if (!result.ok) {
      expect(result.message).toContain('429');
      expect(result.message).not.toContain(SECRET_TOKEN);
    }
  });

  it('maps a non-axios error to UPSTREAM_ERROR', async () => {
    httpService.post.mockReturnValue(throwError(() => new Error('boom')));

    const result = await service.detectPersons(Buffer.from('img'), 'a.jpg');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
  });
});
