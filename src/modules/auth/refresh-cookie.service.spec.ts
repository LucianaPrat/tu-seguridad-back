import { Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError } from '../../cross/errors/either';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './refresh-cookie';
import { RefreshCookieService } from './refresh-cookie.service';

describe('RefreshCookieService', () => {
  let configService: { get: jest.Mock };
  let sessionService: { refreshCookieMaxAgeMs: jest.Mock };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };
  let service: RefreshCookieService;

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue('development') };
    sessionService = {
      refreshCookieMaxAgeMs: jest.fn().mockReturnValue(604_800_000),
    };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
    service = new RefreshCookieService(
      configService as never,
      sessionService as never,
    );
  });

  it('puts the refresh token in an HttpOnly, path-scoped cookie', () => {
    service.attach(res as unknown as Response, 'rtoken');

    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'rtoken',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: REFRESH_COOKIE_PATH,
        maxAge: 604_800_000,
      }),
    );
  });

  it('marks the cookie secure in production', () => {
    configService.get.mockReturnValue('production');

    service.attach(res as unknown as Response, 'rtoken');

    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'rtoken',
      expect.objectContaining({ secure: true }),
    );
  });

  it('keeps the refresh token out of the response body', () => {
    const result = service.issueSession(
      res as unknown as Response,
      buildData({ accessToken: 'atoken', refreshToken: 'rtoken' }),
    );

    expect(result).toEqual({ ok: true, data: { accessToken: 'atoken' } });
    expect(JSON.stringify(result)).not.toContain('rtoken');
  });

  it('sets no cookie when the flow failed', () => {
    const failure = buildError<{ accessToken: string; refreshToken: string }>(
      ErrorCode.UNAUTHORIZED,
    );

    const result = service.issueSession(res as unknown as Response, failure);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(result).toBe(failure);
  });

  it('clears the cookie on the scoped path', () => {
    service.clear(res as unknown as Response);

    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, {
      path: REFRESH_COOKIE_PATH,
    });
  });
});
