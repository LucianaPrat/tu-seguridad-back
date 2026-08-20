import request from 'supertest';

/**
 * The refresh token rides an HttpOnly cookie, so a spec that wants it has to
 * reach into `set-cookie` — which supertest types as a single string. One place
 * owns that cast and the cookie name: a rename, or the next change to
 * supertest's header typing, lands in one file instead of every session spec.
 *
 * Throws rather than returning `undefined`, so an assertion on a cookie that was
 * never sent fails on the missing cookie instead of passing vacuously.
 */
export function refreshCookie(res: request.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = cookies?.find((entry) => entry.startsWith('refresh_token='));
  if (!cookie) {
    throw new Error('no refresh_token cookie on the response');
  }
  return cookie;
}
