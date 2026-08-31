import * as Joi from 'joi';
import { EnvNames } from '../common/constants';

const stringRequiredInProduction = (devDefault: string) =>
  Joi.string().when(EnvNames.NODE_ENV, {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().default(devDefault),
  });

// Same rule, for a variable whose dev default is a placeholder committed in
// .env.example rather than a real working value. Production must reject the
// placeholder outright: `.required()` alone waves it through, because the
// variable *is* set — it is just published in the repo, so an operator who
// copies the example file verbatim signs every token with a secret anyone with
// repo access can read.
const secretRequiredInProduction = (placeholder: string) =>
  Joi.string().when(EnvNames.NODE_ENV, {
    is: 'production',
    then: Joi.string().required().invalid(placeholder).messages({
      'any.invalid':
        '{{#label}} must not be the placeholder value committed in .env.example',
    }),
    otherwise: Joi.string().default(placeholder),
  });

const ADMIN_PASSWORD_MIN_LENGTH = 16;

// MySQL MEDIUMBLOB tops out at 16,777,215 bytes. The limit an operator may set
// stays under it: a snapshot the column cannot hold fails at the write, after
// the DVR round trip and the detection call have already been paid for.
const MEDIUMBLOB_MAX_BYTES = 16_777_215;

const ENCRYPTION_KEY_BYTES = 32;

// Committed in .env.example so a fresh clone boots. That is exactly why
// production must not accept it: an operator who copies the example file
// verbatim would encrypt every DVR password under a key published in the repo,
// and a 32-byte length check alone waves it through.
const DEV_PLACEHOLDER_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const encryptionKeySchema = () =>
  Joi.string()
    .base64()
    .custom((value: string, helpers) =>
      Buffer.from(value, 'base64').length === ENCRYPTION_KEY_BYTES
        ? value
        : helpers.error('key.length'),
    )
    .messages({
      'key.length': `{{#label}} must decode to exactly ${ENCRYPTION_KEY_BYTES} bytes`,
      'key.placeholder':
        '{{#label}} must not be the placeholder key committed in .env.example',
    });

// The placeholder is rejected by its decoded bytes, and against the dev default
// this schema was actually given. A base64 string comparison would catch one
// spelling of four: the last base64 character of a 32-byte value carries two
// unconstrained padding bits, so `A...A=`, `A...B=`, `A...C=` and `A...D=` all
// decode to the same all-zero key.
const base64KeyRequiredInProduction = (devDefault: string) => {
  const devDefaultBytes = Buffer.from(devDefault, 'base64');
  return encryptionKeySchema().when(EnvNames.NODE_ENV, {
    is: 'production',
    then: Joi.string()
      .required()
      .custom((value: string, helpers) =>
        Buffer.from(value, 'base64').equals(devDefaultBytes)
          ? helpers.error('key.placeholder')
          : value,
      ),
    otherwise: Joi.string().default(devDefault),
  });
};

/** One rung of the poll cadence ladder: whole seconds, at most an hour apart. */
const pollCadenceSeconds = (seconds: number) =>
  Joi.number().integer().min(1).max(3600).default(seconds);

export const envValidationSchema = Joi.object({
  [EnvNames.NODE_ENV]: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  [EnvNames.PORT]: Joi.number().port().default(3000),
  [EnvNames.CORS_ORIGINS]: Joi.string().default(
    'http://localhost:5173,http://localhost:8443',
  ),
  [EnvNames.LOG_LEVEL]: Joi.string().default('info'),

  [EnvNames.JWT_SECRET]: secretRequiredInProduction('change-me'),
  [EnvNames.JWT_EXPIRES_IN]: Joi.string().default('15m'),
  [EnvNames.JWT_REFRESH_SECRET]: secretRequiredInProduction('change-me-too'),
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

  [EnvNames.DATABASE_URL]: secretRequiredInProduction(
    'mysql://USER:PASSWORD@127.0.0.1:3306/tu-seguridad',
  ),
  [EnvNames.DATABASE_URL_TEST]: Joi.string().default(
    'mysql://USER:PASSWORD@127.0.0.1:3306/tu-seguridad-test',
  ),
  [EnvNames.SHADOW_DATABASE_URL]: Joi.string().optional(),
  [EnvNames.DVR_PASSWORD_ENCRYPTION_KEY]:
    base64KeyRequiredInProduction(DEV_PLACEHOLDER_KEY),

  [EnvNames.FACE_AUTH_API_URL]: stringRequiredInProduction(
    'https://api.face-auth.me',
  ),
  [EnvNames.FACE_AUTH_DOMAIN]: secretRequiredInProduction('change-me'),
  // The tenant's long-lived client token. It is not what a protected endpoint
  // accepts: it is exchanged at `/api/v1/auth/authorize` for a short-lived
  // session token, and only that one is sent as `Fa-Token`.
  [EnvNames.FACE_AUTH_CLIENT_TOKEN]: secretRequiredInProduction('change-me'),
  [EnvNames.DETECT_TIMEOUT_MS]: Joi.number().default(10000),

  [EnvNames.DVR_TIMEOUT_MS]: Joi.number().default(5000),
  // RTSP is a different service on a different port from the ISAPI base URL, and
  // the recorder row stores only the HTTP one. A knob rather than a column
  // because a space owns exactly one recorder today and none of them moves 554.
  [EnvNames.DVR_RTSP_PORT]: Joi.number().port().default(554),
  // The sub-stream by default: the dashboard plays this in a hover-sized box,
  // and the recorder's uplink carries every viewer. `main` is there for the day
  // a full-frame view needs the native resolution.
  [EnvNames.DVR_RTSP_STREAM]: Joi.string().valid('main', 'sub').default('sub'),

  [EnvNames.POLLING_ENABLED]: Joi.boolean().default(false),
  // The poll cadence ladder. A camera moves between the three depending on what
  // its last frame showed, and the scheduler's single interval runs at the
  // shortest of them — there is deliberately no separate base-tick knob to get
  // out of step with these.
  [EnvNames.POLLING_PASSIVE_SECONDS]: pollCadenceSeconds(15),
  [EnvNames.POLLING_ACTIVE_SECONDS]: pollCadenceSeconds(10),
  [EnvNames.POLLING_DETECTION_SECONDS]: pollCadenceSeconds(5),
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

  // Live streaming is opt-in and a clean refusal when off, same posture as
  // OTEL_ENABLED and MAIL_ENABLED: no media server on the network means
  // `GET /cameras/:id/live` answers CONFLICT, and nothing else changes.
  // Defaults describe a MediaMTX on the same host with its stock ports, so a
  // developer who flips the switch needs no other variable.
  [EnvNames.MEDIAMTX_ENABLED]: Joi.boolean().default(false),
  // The Control API. Private by definition — it takes recorder credentials and
  // it authenticates nobody, so it must never be bound to a public interface.
  [EnvNames.MEDIAMTX_API_URL]: Joi.string()
    .uri()
    .default('http://127.0.0.1:9997'),
  // The HLS base the browser reaches, which is not the address above: one is
  // reached by this process, the other by the operator's laptop.
  [EnvNames.MEDIAMTX_PUBLIC_URL]: Joi.string()
    .uri()
    .default('http://127.0.0.1:8888'),
  [EnvNames.MEDIAMTX_TIMEOUT_MS]: Joi.number().default(5000),

  // Mail is opt-in: unset means credentials are only logged, exactly as before a
  // transport existed. Defaults describe the local mailpit container, so a
  // developer who flips the switch needs no other variable.
  [EnvNames.MAIL_ENABLED]: Joi.boolean().default(false),
  [EnvNames.SMTP_HOST]: Joi.string().default('127.0.0.1'),
  [EnvNames.SMTP_PORT]: Joi.number().port().default(1025),
  // Optional on purpose: mailpit accepts unauthenticated submission, and an empty
  // string must not become a login attempt with a blank password.
  [EnvNames.SMTP_USER]: Joi.string().allow('').optional(),
  [EnvNames.SMTP_PASSWORD]: Joi.string().allow('').optional(),
  [EnvNames.MAIL_FROM]: Joi.string().default(
    'Tu Seguridad <no-reply@tu-seguridad.local>',
  ),
  // ponytail: defaulted rather than required in production, because a production
  // boot with MAIL_ENABLED=false must not be blocked by a mail variable. Promote
  // it to stringRequiredInProduction when mail actually ships, and add it to the
  // schema spec's productionEnv fixture in the same change.
  [EnvNames.APP_BASE_URL]: Joi.string().uri().default('http://localhost:5173'),
});
