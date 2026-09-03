import type { AlertChannel, AlertType } from '@prisma/client';

export const EnvNames = {
  NODE_ENV: 'NODE_ENV',
  PORT: 'PORT',
  CORS_ORIGINS: 'CORS_ORIGINS',
  LOG_LEVEL: 'LOG_LEVEL',

  JWT_SECRET: 'JWT_SECRET',
  JWT_EXPIRES_IN: 'JWT_EXPIRES_IN',
  JWT_REFRESH_SECRET: 'JWT_REFRESH_SECRET',
  JWT_REFRESH_EXPIRES_IN: 'JWT_REFRESH_EXPIRES_IN',
  ADMIN_EMAIL: 'ADMIN_EMAIL',
  ADMIN_PASSWORD: 'ADMIN_PASSWORD',

  DATABASE_URL: 'DATABASE_URL',
  DATABASE_URL_TEST: 'DATABASE_URL_TEST',
  SHADOW_DATABASE_URL: 'SHADOW_DATABASE_URL',
  DVR_PASSWORD_ENCRYPTION_KEY: 'DVR_PASSWORD_ENCRYPTION_KEY',

  FACE_AUTH_API_URL: 'FACE_AUTH_API_URL',
  FACE_AUTH_DOMAIN: 'FACE_AUTH_DOMAIN',
  FACE_AUTH_CLIENT_TOKEN: 'FACE_AUTH_CLIENT_TOKEN',
  DETECT_TIMEOUT_MS: 'DETECT_TIMEOUT_MS',

  DVR_TIMEOUT_MS: 'DVR_TIMEOUT_MS',
  DVR_RTSP_PORT: 'DVR_RTSP_PORT',
  DVR_RTSP_STREAM: 'DVR_RTSP_STREAM',

  MEDIAMTX_ENABLED: 'MEDIAMTX_ENABLED',
  MEDIAMTX_API_URL: 'MEDIAMTX_API_URL',
  MEDIAMTX_PUBLIC_URL: 'MEDIAMTX_PUBLIC_URL',
  MEDIAMTX_TIMEOUT_MS: 'MEDIAMTX_TIMEOUT_MS',

  POLLING_ENABLED: 'POLLING_ENABLED',
  POLLING_PASSIVE_SECONDS: 'POLLING_PASSIVE_SECONDS',
  POLLING_ACTIVE_SECONDS: 'POLLING_ACTIVE_SECONDS',
  POLLING_DETECTION_SECONDS: 'POLLING_DETECTION_SECONDS',
  POLLING_CONCURRENCY: 'POLLING_CONCURRENCY',
  SNAPSHOT_TIMEOUT_MS: 'SNAPSHOT_TIMEOUT_MS',
  DVR_CAPTURE_RETRIES: 'DVR_CAPTURE_RETRIES',
  SNAPSHOT_MAX_BYTES: 'SNAPSHOT_MAX_BYTES',
  SNAPSHOT_LIVE_WRITE_SECONDS: 'SNAPSHOT_LIVE_WRITE_SECONDS',
  ENTER_CONSECUTIVE_POLLS: 'ENTER_CONSECUTIVE_POLLS',
  EXIT_CONSECUTIVE_POLLS: 'EXIT_CONSECUTIVE_POLLS',
  ALERT_COOLDOWN_SECONDS: 'ALERT_COOLDOWN_SECONDS',

  THROTTLE_TTL_SECONDS: 'THROTTLE_TTL_SECONDS',
  THROTTLE_LIMIT: 'THROTTLE_LIMIT',

  SWAGGER_ENABLED: 'SWAGGER_ENABLED',

  RETENTION_ENABLED: 'RETENTION_ENABLED',
  RETENTION_TOKEN_DAYS: 'RETENTION_TOKEN_DAYS',
  RETENTION_INVITATION_DAYS: 'RETENTION_INVITATION_DAYS',
  RETENTION_SNAPSHOT_DAYS: 'RETENTION_SNAPSHOT_DAYS',
  RETENTION_BATCH_SIZE: 'RETENTION_BATCH_SIZE',

  DELIVERY_RETRY_ENABLED: 'DELIVERY_RETRY_ENABLED',
  DELIVERY_RETRY_DELAY_SECONDS: 'DELIVERY_RETRY_DELAY_SECONDS',
  DELIVERY_RETRY_MAX_ATTEMPTS: 'DELIVERY_RETRY_MAX_ATTEMPTS',

  OTEL_ENABLED: 'OTEL_ENABLED',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'OTEL_EXPORTER_OTLP_ENDPOINT',
  OTEL_SERVICE_NAME: 'OTEL_SERVICE_NAME',

  SENTRY_DSN: 'SENTRY_DSN',

  METRICS_TOKEN: 'METRICS_TOKEN',

  MAIL_ENABLED: 'MAIL_ENABLED',
  SMTP_HOST: 'SMTP_HOST',
  SMTP_PORT: 'SMTP_PORT',
  SMTP_USER: 'SMTP_USER',
  SMTP_PASSWORD: 'SMTP_PASSWORD',
  MAIL_FROM: 'MAIL_FROM',
  APP_BASE_URL: 'APP_BASE_URL',

  ASSISTANT_ENABLED: 'ASSISTANT_ENABLED',
  ASSISTANT_API_URL: 'ASSISTANT_API_URL',
  ASSISTANT_API_TOKEN: 'ASSISTANT_API_TOKEN',
  ASSISTANT_MODEL: 'ASSISTANT_MODEL',
  ASSISTANT_TIMEOUT_MS: 'ASSISTANT_TIMEOUT_MS',
} as const;

export type EnvName = (typeof EnvNames)[keyof typeof EnvNames];

/**
 * Rate limits for the routes where the global allowance is the wrong shape.
 *
 * Constants rather than env vars for the same reason `CredentialTtl` is one:
 * these are product rules, and the only two places allowed to read
 * `process.env` are `main.ts` and `tracing.ts` — a `@Throttle` decorator is
 * evaluated at module load and could not read config anyway.
 *
 * `CREDENTIAL` covers every route that takes an email address or a one-time
 * token and answers the same whether or not the account exists: login,
 * password reset, magic link, invitation acceptance, face identity. The point
 * is not to stop a determined attacker but to make credential stuffing and
 * timing measurement cost something — the equal-cost lookup is the other half
 * of that answer.
 *
 * `INBOUND` covers `POST /events/acknowledgements`, which is unauthenticated
 * and whose caller is a notification provider or a person clicking a link in a
 * mail: neither of them needs more than a handful of calls a minute.
 *
 * `ASSISTANT` covers `POST /assistant/chat`, and it is the one limit here that
 * is about money rather than about an attacker: every call is a paid request to
 * an LLM gateway, and the global allowance of ten a second would let one bored
 * member run up a bill on a route that a person types into by hand.
 */
export const RouteThrottle = {
  CREDENTIAL: { limit: 10, ttlSeconds: 60 },
  INBOUND: { limit: 30, ttlSeconds: 60 },
  ASSISTANT: { limit: 20, ttlSeconds: 60 },
} as const;

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_ZONE = 'INVALID_ZONE',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  UPSTREAM_ERROR = 'UPSTREAM_ERROR',
  UPSTREAM_TIMEOUT = 'UPSTREAM_TIMEOUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export const ERROR_CODE_HTTP_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INVALID_ZONE]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.UPSTREAM_ERROR]: 502,
  [ErrorCode.UPSTREAM_TIMEOUT]: 504,
  [ErrorCode.INTERNAL_ERROR]: 500,
};

/**
 * Lifetimes of the one-time credentials in `auth_tokens` and `invitations`.
 * Constants, not env vars: these are product rules the operator has no reason
 * to retune per host, and every one of them ships with its own delivery flow.
 */
export const CredentialTtl = {
  MAGIC_LINK_MINUTES: 15,
  PASSWORD_RESET_MINUTES: 30,
  INVITATION_DAYS: 7,
} as const;

/**
 * Password and credential rules the DTOs validate against. One place, because the
 * registration, invitation-completion and password-reset bodies must agree: a
 * reset that accepted a weaker password than registration would be the way in.
 */
export const AuthPolicy = {
  MIN_PASSWORD_LENGTH: 12,
  MAX_PASSWORD_LENGTH: 128,
  MAX_NAME_LENGTH: 100,
  MAX_SPACE_NAME_LENGTH: 120,
  MAX_TOKEN_LENGTH: 512,
  MAX_AVATAR_URL_LENGTH: 2048,
} as const;

/**
 * E.164, the format the call and WhatsApp channels need. `class-validator`'s
 * `@IsPhoneNumber` would pull in libphonenumber for a rule this narrow.
 */
export const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * Routing matrix a brand-new space starts with. Only email is enabled: it is the
 * one channel that needs no provider account, and a space that notifies on
 * nothing is a silent alarm. Shared by `prisma/seed.ts` and registration so the
 * two cannot disagree.
 */
export const ALERT_ROUTING_DEFAULTS: readonly {
  alertType: AlertType;
  channel: AlertChannel;
  enabled: boolean;
}[] = [
  { alertType: 'intruder', channel: 'call', enabled: false },
  { alertType: 'intruder', channel: 'whatsapp', enabled: false },
  { alertType: 'intruder', channel: 'email', enabled: true },
  { alertType: 'suspicious', channel: 'call', enabled: false },
  { alertType: 'suspicious', channel: 'whatsapp', enabled: false },
  { alertType: 'suspicious', channel: 'email', enabled: true },
];

/**
 * Alert history paging. `alert_events` is the highest-volume table in the
 * schema, so every list answer is bounded: the setup-era `/events` route
 * returned a default 100 rows with no cursor and got slower as a space aged.
 */
export const EventHistory = {
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
  MAX_CURSOR_LENGTH: 128,
} as const;

export const PipelineDefaults = {
  CONFIDENCE_THRESHOLD: 0.45,
  ENTER_CONSECUTIVE_POLLS: 2,
  EXIT_CONSECUTIVE_POLLS: 3,
} as const;

/**
 * Monitor zones are a percentage rectangle over the snapshot, not pixels: the
 * DVR resolution or the snapshot size can change without invalidating a zone.
 * The same bounds are enforced three times — DTO decorators, the service, and
 * the `monitor_zones_rectangle_bounds_check` constraint in MySQL — because
 * only the last one survives a write that never went through this API.
 */
export const ZoneGeometry = {
  MIN_PERCENT: 0,
  MAX_PERCENT: 100,
  DECIMAL_PLACES: 2,
  /** Fewer than three points enclose no area, so they are not an outline. */
  MIN_OUTLINE_POINTS: 3,
  /**
   * A hand-drawn outline is sampled every percent or so of the frame, which
   * lands well under this. The cap is what keeps a crafted request from
   * writing an unbounded JSON document per zone.
   */
  MAX_OUTLINE_POINTS: 500,
} as const;
