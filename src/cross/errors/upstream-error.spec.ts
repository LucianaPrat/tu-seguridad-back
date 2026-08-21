import { AxiosError } from 'axios';
import { ErrorCode } from '../common/constants';
import { mapUpstreamError } from './upstream-error';

describe('mapUpstreamError', () => {
  it('opens every message with the operation label', () => {
    const error = new AxiosError('Request failed');
    error.response = { status: 503 } as never;

    expect(mapUpstreamError(error, 'DVR snapshot fetch')).toEqual({
      ok: false,
      code: ErrorCode.UPSTREAM_ERROR,
      message: 'DVR snapshot fetch failed (status 503)',
    });
  });

  it('calls an upstream that never answered unreachable', () => {
    expect(
      mapUpstreamError(new AxiosError('socket hang up'), 'Publish'),
    ).toEqual({
      ok: false,
      code: ErrorCode.UPSTREAM_ERROR,
      message: 'Publish failed (status unreachable)',
    });
  });

  // Three shapes of the same thing: axios aborts a client-side deadline as
  // ECONNABORTED, a connect timeout as ETIMEDOUT, and some adapters only say so
  // in the message. One place owns the heuristic so it cannot drift.
  it.each([
    ['ECONNABORTED', 'Request failed'],
    ['ETIMEDOUT', 'Request failed'],
    [undefined, 'timeout of 5000ms exceeded'],
  ])('maps %s / "%s" to UPSTREAM_TIMEOUT', (code, message) => {
    const error = new AxiosError(message);
    error.code = code;

    expect(mapUpstreamError(error, 'Publish')).toEqual({
      ok: false,
      code: ErrorCode.UPSTREAM_TIMEOUT,
      message: 'Publish timed out',
    });
  });

  it('does not treat a non-axios throw as a reachable upstream', () => {
    expect(mapUpstreamError(new Error('something else'), 'Publish')).toEqual({
      ok: false,
      code: ErrorCode.UPSTREAM_ERROR,
      message: 'Publish failed',
    });
  });
});
