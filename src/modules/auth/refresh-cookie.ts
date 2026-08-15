import { CookieOptions } from 'express';

export const REFRESH_COOKIE_NAME = 'refresh_token';

/**
 * Scoped to the auth routes: the browser never attaches the refresh token to
 * cameras, events or zones requests, which run on the bearer access token.
 */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * `httpOnly` is the whole point — JavaScript cannot read the refresh token, so
 * an XSS cannot exfiltrate a credential that outlives the page.
 *
 * `sameSite: 'lax'` is enough while the frontend and the API share a site;
 * ports are not part of a site, so localhost:8443 -> localhost:3000 qualifies.
 * A production split across registrable domains forces `none` + `secure`, and
 * that combination needs a CSRF token on the refresh route.
 */
export function buildRefreshCookieOptions(
  isProduction: boolean,
  maxAgeMs: number,
): CookieOptions {
  return {
    httpOnly: true,
    // Over plain http in development the browser drops a `secure` cookie.
    secure: isProduction,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}
