import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { ErrorCode } from '../../cross/common/constants';
import { SnapshotService } from './snapshot.service';

describe('SnapshotService', () => {
  let httpService: { get: jest.Mock };
  let configService: { get: jest.Mock };
  let service: SnapshotService;

  beforeEach(() => {
    httpService = { get: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(5000) };
    service = new SnapshotService(httpService as never, configService as never);
  });

  it('returns the image buffer on a successful image response', async () => {
    httpService.get.mockReturnValue(
      of({
        data: Buffer.from('jpeg-bytes'),
        headers: { 'content-type': 'image/jpeg' },
      }),
    );

    const result = await service.fetch({ snapshotUrl: 'http://dvr/snap.jpg' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.toString()).toBe('jpeg-bytes');
    }
  });

  it('rejects a non-image content-type', async () => {
    httpService.get.mockReturnValue(
      of({
        data: Buffer.from('<html></html>'),
        headers: { 'content-type': 'text/html' },
      }),
    );

    const result = await service.fetch({ snapshotUrl: 'http://dvr/snap.jpg' });

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
  });

  it('maps a timeout to UPSTREAM_TIMEOUT', async () => {
    httpService.get.mockReturnValue(
      throwError(() =>
        Object.assign(new AxiosError('timeout of 5000ms exceeded'), {
          code: 'ECONNABORTED',
        }),
      ),
    );

    const result = await service.fetch({ snapshotUrl: 'http://dvr/snap.jpg' });

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_TIMEOUT,
    });
  });

  it('never includes the snapshot URL in an error message', async () => {
    const secretUrl = 'http://user:secret-password@dvr.local/snap.jpg';
    httpService.get.mockReturnValue(
      throwError(() => new AxiosError('Request failed with status code 500')),
    );

    const result = await service.fetch({ snapshotUrl: secretUrl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain(secretUrl);
      expect(result.message).not.toContain('secret-password');
    }
  });
});
