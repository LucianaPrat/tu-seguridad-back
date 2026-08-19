import * as Joi from 'joi';
import { EnvNames } from '../common/constants';

const stringRequiredInProduction = (devDefault: string) =>
  Joi.string().when(EnvNames.NODE_ENV, {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().default(devDefault),
  });

const ADMIN_PASSWORD_MIN_LENGTH = 16;

// MySQL MEDIUMBLOB tops out at 16,777,215 bytes. The limit an operator may set
// stays under it: a snapshot the column cannot hold fails at the write, after
// the DVR round trip and the detection call have already been paid for.
const MEDIUMBLOB_MAX_BYTES = 16_777_215;

const encryptionKeySchema = () =>
  Joi.string()
    .base64()
    .custom((value: unknown, helpers) => {
      if (typeof value !== 'string') {
        return helpers.error('any.invalid');
      }
      return Buffer.from(value, 'base64').length === 32
        ? value
        : helpers.error('any.invalid');
    })
    .messages({ 'any.invalid': 'must decode to exactly 32 bytes' });

const base64KeyRequiredInProduction = (devDefault: string) =>
  encryptionKeySchema().when(EnvNames.NODE_ENV, {
    is: 'production',
    then: encryptionKeySchema().required(),
    otherwise: encryptionKeySchema().default(devDefault),
  });

export const envValidationSchema = Joi.object({
  [EnvNames.NODE_ENV]: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  [EnvNames.PORT]: Joi.number().port().default(3000),
  [EnvNames.CORS_ORIGINS]: Joi.string().default(
    'http://localhost:5173,http://localhost:8443',
  ),
  [EnvNames.LOG_LEVEL]: Joi.string().default('info'),

  [EnvNames.JWT_SECRET]: stringRequiredInProduction('change-me'),
  [EnvNames.JWT_EXPIRES_IN]: Joi.string().default('15m'),
  [EnvNames.JWT_REFRESH_SECRET]: stringRequiredInProduction('change-me-too'),
  [EnvNames.JWT_REFRESH_EXPIRES_IN]: Joi.string().default('7d'),
  [EnvNames.ADMIN_EMAIL]: Joi.string()
    .email({ tlds: { allow: false } })
    .default('admin@example.com'),
  // The seed builds a profile-complete, active admin that owns the space and holds the admin
  // membership. Leaving this unset in production would publish that account under the placeholder
  // password committed in .env.example, so production must supply a real one.
  [EnvNames.ADMIN_PASSWORD]: Joi.string().when(EnvNames.NODE_ENV, {
    is: 'production',
    then: Joi.string().min(ADMIN_PASSWORD_MIN_LENGTH).required(),
    otherwise: Joi.string().default('change-me'),
  }),

  [EnvNames.DATABASE_URL]: stringRequiredInProduction(
    'mysql://USER:PASSWORD@127.0.0.1:3306/tu-seguridad',
  ),
  [EnvNames.DATABASE_URL_TEST]: Joi.string().default(
    'mysql://USER:PASSWORD@127.0.0.1:3306/tu-seguridad-test',
  ),
  [EnvNames.SHADOW_DATABASE_URL]: Joi.string().optional(),
  [EnvNames.DVR_PASSWORD_ENCRYPTION_KEY]: base64KeyRequiredInProduction(
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  ),

  [EnvNames.FACE_AUTH_API_URL]: stringRequiredInProduction(
    'https://api.face-auth.me',
  ),
  [EnvNames.FACE_AUTH_DOMAIN]: stringRequiredInProduction('change-me'),
  [EnvNames.FACE_AUTH_TOKEN]: stringRequiredInProduction('change-me'),
  [EnvNames.DETECT_TIMEOUT_MS]: Joi.number().default(10000),

  [EnvNames.DVR_TIMEOUT_MS]: Joi.number().default(5000),

  [EnvNames.POLLING_ENABLED]: Joi.boolean().default(false),
  [EnvNames.POLLING_INTERVAL_SECONDS]: Joi.number()
    .integer()
    .min(1)
    .max(3600)
    .default(5),
  [EnvNames.SNAPSHOT_TIMEOUT_MS]: Joi.number().default(5000),
  [EnvNames.SNAPSHOT_MAX_BYTES]: Joi.number()
    .integer()
    .min(1024)
    .max(MEDIUMBLOB_MAX_BYTES)
    .default(2_000_000),
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
});
