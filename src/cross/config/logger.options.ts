import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Options } from 'pino-http';
import { EnvNames } from '../common/constants';

const SENSITIVE_KEYS = new Set(['snapshotUrl']);
const MAX_REDACT_DEPTH = 8;
// req/res/err are live http objects consumed by pino-http's own serializers
// (e.g. res.headersSent is a prototype getter) — cloning them here would break those.
const PINO_HTTP_RESERVED_KEYS = new Set(['req', 'res', 'err']);

function deepRedact(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepRedact(item, depth + 1));
  }
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    result[key] = SENSITIVE_KEYS.has(key)
      ? '***'
      : deepRedact(source[key], depth + 1);
  }
  return result;
}

function redactLogObject(
  object: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(object)) {
    result[key] = PINO_HTTP_RESERVED_KEYS.has(key)
      ? object[key]
      : deepRedact(object[key]);
  }
  return result;
}

export const createPinoHttpOptions = (config: ConfigService): Options => {
  const isProduction = config.get<string>(EnvNames.NODE_ENV) === 'production';

  return {
    level: config.get<string>(EnvNames.LOG_LEVEL),
    genReqId: () => randomUUID(),
    transport: isProduction
      ? undefined
      : { target: 'pino-pretty', options: { singleLine: true } },
    redact: {
      paths: ['req.headers.authorization', 'req.headers["fa-token"]'],
      censor: '[Redacted]',
    },
    formatters: {
      log: redactLogObject,
    },
  };
};
