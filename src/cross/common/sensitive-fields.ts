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
