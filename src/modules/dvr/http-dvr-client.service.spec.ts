import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { HttpDvrClientService } from './http-dvr-client.service';

const connection = {
  url: 'http://192.168.1.10:8000/',
  username: 'admin',
  password: 'dvr-password',
};

function axiosResponse<T>(data: T, headers: Record<string, string> = {}) {
  return of({ data, headers } as AxiosResponse<T>);
}

function axiosFailure(status?: number, code?: string) {
  const error = new AxiosError('request failed', code);
  if (status) {
    error.response = { status } as AxiosResponse;
  }
  return throwError(() => error);
}

describe('HttpDvrClientService', () => {
  const maxBytes = 1000;

  let httpService: { get: jest.Mock };
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };
  let client: HttpDvrClientService;

  beforeEach(() => {
    httpService = { get: jest.fn() };
    const values: Record<string, number> = {
      [EnvNames.DVR_TIMEOUT_MS]: 5000,
      [EnvNames.SNAPSHOT_TIMEOUT_MS]: 5000,
      [EnvNames.SNAPSHOT_MAX_BYTES]: maxBytes,
    };
    configService = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => values[key]),
    };
    client = new HttpDvrClientService(
      httpService as never,
      configService as never,
    );
  });

  describe('discoverChannels', () => {
    it('joins the base url without doubling the separator', async () => {
      httpService.get.mockReturnValue(axiosResponse([]));

      await client.discoverChannels(connection);

      expect(httpService.get).toHaveBeenCalledWith(
        'http://192.168.1.10:8000/api/channels',
        expect.objectContaining({
          auth: { username: 'admin', password: 'dvr-password' },
        }),
      );
    });

    it('maps a channel listing, defaulting an unreported channel to online', async () => {
      httpService.get.mockReturnValue(
        axiosResponse([
          { id: 1, name: 'Front', location: 'Street', online: false },
          { id: 'ch2' },
        ]),
      );

      const result = await client.discoverChannels(connection);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([
          {
            externalId: '1',
            name: 'Front',
            location: 'Street',
            status: 'offline',
          },
          { externalId: 'ch2', name: 'ch2', location: null, status: 'online' },
        ]);
      }
    });

    it('drops a channel with no usable identifier', async () => {
      httpService.get.mockReturnValue(axiosResponse([{ name: 'nameless' }]));

      const result = await client.discoverChannels(connection);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([]);
      }
    });

    it('reports a non-list answer as an upstream error', async () => {
      httpService.get.mockReturnValue(axiosResponse({ channels: [] }));

      const result = await client.discoverChannels(connection);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
      });
    });

    /** A reachable recorder that refuses the password is the operator's 400. */
    it('maps a credential rejection to VALIDATION_ERROR', async () => {
      httpService.get.mockReturnValue(axiosFailure(401));

      const result = await client.discoverChannels(connection);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('maps a timeout to UPSTREAM_TIMEOUT', async () => {
      httpService.get.mockReturnValue(axiosFailure(undefined, 'ECONNABORTED'));

      const result = await client.discoverChannels(connection);

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_TIMEOUT,
      });
    });
  });

  describe('captureSnapshot', () => {
    it('describes the frame with its mime type, size and digest', async () => {
      const bytes = Buffer.from('image-bytes');
      httpService.get.mockReturnValue(
        axiosResponse(bytes, { 'content-type': 'image/jpeg; charset=binary' }),
      );

      const result = await client.captureSnapshot(connection, 'ch2');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mimeType).toBe('image/jpeg');
        expect(result.data.byteSize).toBe(bytes.byteLength);
        expect(result.data.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('caps the transfer at the configured snapshot limit', async () => {
      httpService.get.mockReturnValue(
        axiosResponse(Buffer.from('x'), { 'content-type': 'image/jpeg' }),
      );

      await client.captureSnapshot(connection, 'ch2');

      expect(httpService.get).toHaveBeenCalledWith(
        'http://192.168.1.10:8000/api/channels/ch2/snapshot',
        expect.objectContaining({ maxContentLength: maxBytes }),
      );
    });

    it('rejects an oversized frame that slipped past the transfer cap', async () => {
      httpService.get.mockReturnValue(
        axiosResponse(Buffer.alloc(maxBytes + 1), {
          'content-type': 'image/jpeg',
        }),
      );

      const result = await client.captureSnapshot(connection, 'ch2');

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
      });
    });

    it('rejects an answer that is not an image', async () => {
      httpService.get.mockReturnValue(
        axiosResponse(Buffer.from('<html>'), { 'content-type': 'text/html' }),
      );

      const result = await client.captureSnapshot(connection, 'ch2');

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.UPSTREAM_ERROR,
      });
    });

    it('escapes the channel identifier in the path', async () => {
      httpService.get.mockReturnValue(
        axiosResponse(Buffer.from('x'), { 'content-type': 'image/jpeg' }),
      );

      await client.captureSnapshot(connection, 'ch 2/../secret');

      expect(httpService.get).toHaveBeenCalledWith(
        'http://192.168.1.10:8000/api/channels/ch%202%2F..%2Fsecret/snapshot',
        expect.anything(),
      );
    });
  });
});
