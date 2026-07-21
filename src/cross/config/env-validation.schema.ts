import * as Joi from 'joi';
import { EnvNames } from '../common/constants';
import { normalizeEncryptionKey } from '../crypto/field-encryption';

const stringRequiredInProduction = (devDefault: string) =>
  Joi.string().when(EnvNames.NODE_ENV, {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().default(devDefault),
  });

// Obvious dev-only 256-bit key (64 hex chars). Production must supply its own.
const DEV_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Rejects a present-but-malformed key at boot (must decode to 32 bytes).
const encryptionKey = Joi.string().custom((value: string, helpers) => {
  try {
    normalizeEncryptionKey(value);
    return value;
  } catch {
    return helpers.error('any.invalid');
  }
}, 'aes-256 key');

export const envValidationSchema = Joi.object({
  [EnvNames.NODE_ENV]: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  [EnvNames.PORT]: Joi.number().port().default(3000),
  [EnvNames.CORS_ORIGINS]: Joi.string().default('http://localhost:5173'),
  [EnvNames.LOG_LEVEL]: Joi.string().default('info'),

  [EnvNames.JWT_SECRET]: stringRequiredInProduction('change-me'),
  [EnvNames.JWT_EXPIRES_IN]: Joi.string().default('15m'),
  [EnvNames.JWT_REFRESH_SECRET]: stringRequiredInProduction('change-me-too'),
  [EnvNames.JWT_REFRESH_EXPIRES_IN]: Joi.string().default('7d'),
  [EnvNames.ADMIN_EMAIL]: Joi.string()
    .email({ tlds: { allow: false } })
    .default('admin@example.com'),
  [EnvNames.ADMIN_PASSWORD]: Joi.string().default('change-me'),

  [EnvNames.DATABASE_URL]: stringRequiredInProduction(
    'mysql://USER:PASSWORD@127.0.0.1:3306/tu-seguridad',
  ),
  [EnvNames.DATABASE_URL_TEST]: Joi.string().default(
    'mysql://USER:PASSWORD@127.0.0.1:3306/tu-seguridad-test',
  ),
  [EnvNames.SHADOW_DATABASE_URL]: Joi.string().optional(),

  [EnvNames.FACE_AUTH_API_URL]: stringRequiredInProduction(
    'https://api.face-auth.me',
  ),
  [EnvNames.FACE_AUTH_DOMAIN]: stringRequiredInProduction('change-me'),
  [EnvNames.FACE_AUTH_TOKEN]: stringRequiredInProduction('change-me'),
  [EnvNames.DETECT_TIMEOUT_MS]: Joi.number().default(10000),

  [EnvNames.SNAPSHOT_URL_ENCRYPTION_KEY]: Joi.when(EnvNames.NODE_ENV, {
    is: 'production',
    then: encryptionKey.required(),
    otherwise: encryptionKey.default(DEV_ENCRYPTION_KEY),
  }),

  [EnvNames.POLLING_ENABLED]: Joi.boolean().default(false),
  [EnvNames.SNAPSHOT_TIMEOUT_MS]: Joi.number().default(5000),
  [EnvNames.ENTER_CONSECUTIVE_POLLS]: Joi.number().integer().min(1).default(2),
  [EnvNames.EXIT_CONSECUTIVE_POLLS]: Joi.number().integer().min(1).default(3),

  [EnvNames.THROTTLE_TTL_SECONDS]: Joi.number().default(1),
  [EnvNames.THROTTLE_LIMIT]: Joi.number().default(10),

  [EnvNames.OTEL_ENABLED]: Joi.boolean().default(false),
  [EnvNames.OTEL_EXPORTER_OTLP_ENDPOINT]: Joi.string().default(
    'http://localhost:4318',
  ),
  [EnvNames.OTEL_SERVICE_NAME]: Joi.string().default('tu-seguridad-back'),

  [EnvNames.SENTRY_DSN]: Joi.string().optional(),

  // Shared secret gating GET /metrics. Required in production (no reverse proxy
  // to restrict it); unset in dev leaves the endpoint open for convenience.
  [EnvNames.METRICS_TOKEN]: Joi.string().when(EnvNames.NODE_ENV, {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
});
