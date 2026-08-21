/**
 * The one canonical list of field names that must never leave the process.
 *
 * Every egress channel reads it: Pino's log formatter and Sentry's
 * `beforeSend`/`beforeBreadcrumb`. A new secret-bearing field lands here and is
 * covered everywhere in the same commit — two lists drift, and the drift is
 * only visible in production logs.
 *
 * Matching is case-insensitive, so a header (`authorization`) and a DTO field
 * (`accessToken`) can share one entry.
 */
export const SENSITIVE_FIELD_NAMES = [
  'snapshotUrl',
  // MediaMTX names a path's upstream `source`, and for us that upstream is an
  // RTSP URL with the recorder password in its userinfo. The publish call is
  // outbound, so `pino-http` never sees it, but an axios error carries the
  // request body it was sent with — this keeps the password out of the one
  // channel that would otherwise serialise it.
  'source',
  'passwordEncrypted',
  'tokenHash',
  'correlationId',
  'password',
  'newPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'faceToken',
  'authorization',
  'fa-token',
] as const;

export const SENSITIVE_FIELD_NAMES_LOWERCASE: ReadonlySet<string> = new Set(
  SENSITIVE_FIELD_NAMES.map((name) => name.toLowerCase()),
);
