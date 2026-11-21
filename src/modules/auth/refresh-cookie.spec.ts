import {
  buildRefreshCookieOptions,
  REFRESH_COOKIE_PATH,
} from './refresh-cookie';

describe('buildRefreshCookieOptions', () => {
  it('is always HttpOnly, Lax and scoped to the auth routes', () => {
    const options = buildRefreshCookieOptions(false, 1000);

    expect(options).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: 1000,
    });
  });

  it('drops the secure flag outside production so http dev keeps the cookie', () => {
    expect(buildRefreshCookieOptions(false, 1000).secure).toBe(false);
  });

  it('sets the secure flag in production', () => {
    expect(buildRefreshCookieOptions(true, 1000).secure).toBe(true);
  });
});
