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
  FACE_AUTH_TOKEN: 'FACE_AUTH_TOKEN',
  DETECT_TIMEOUT_MS: 'DETECT_TIMEOUT_MS',

  POLLING_ENABLED: 'POLLING_ENABLED',
  SNAPSHOT_TIMEOUT_MS: 'SNAPSHOT_TIMEOUT_MS',
  ENTER_CONSECUTIVE_POLLS: 'ENTER_CONSECUTIVE_POLLS',
  EXIT_CONSECUTIVE_POLLS: 'EXIT_CONSECUTIVE_POLLS',

  THROTTLE_TTL_SECONDS: 'THROTTLE_TTL_SECONDS',
  THROTTLE_LIMIT: 'THROTTLE_LIMIT',

  OTEL_ENABLED: 'OTEL_ENABLED',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'OTEL_EXPORTER_OTLP_ENDPOINT',
  OTEL_SERVICE_NAME: 'OTEL_SERVICE_NAME',

  SENTRY_DSN: 'SENTRY_DSN',
} as const;

export type EnvName = (typeof EnvNames)[keyof typeof EnvNames];

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_POLYGON = 'INVALID_POLYGON',
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
  [ErrorCode.INVALID_POLYGON]: 400,
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

export const PipelineDefaults = {
  POLLING_INTERVAL_SECONDS: 5,
  CONFIDENCE_THRESHOLD: 0.45,
  ENTER_CONSECUTIVE_POLLS: 2,
  EXIT_CONSECUTIVE_POLLS: 3,
  MIN_ZONE_AREA: 0.0001,
} as const;
