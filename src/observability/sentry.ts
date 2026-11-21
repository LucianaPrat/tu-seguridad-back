import * as Sentry from '@sentry/node';
import { SENSITIVE_FIELD_NAMES_LOWERCASE } from '../cross/common/sensitive-fields';

// Opt-in error tracking, same posture as OTEL: a no-op unless SENTRY_DSN is set.
// Reads process.env directly because init must run before ConfigModule exists
// (mirrors observability/tracing.ts).

// Redacted anywhere they appear in an outgoing event/breadcrumb, off the same
// canonical list the Pino formatter applies.

const REDACTED = '[redacted]';

/** Recursively redact sensitive keys in place so secrets never leave the process. */
export function scrubSensitive<T>(value: T, seen = new WeakSet<object>()): T {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      (value as unknown[])[index] = scrubSensitive(item, seen);
    });
    return value;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (SENSITIVE_FIELD_NAMES_LOWERCASE.has(key.toLowerCase())) {
        record[key] = REDACTED;
      } else {
        record[key] = scrubSensitive(record[key], seen);
      }
    }
  }
  return value;
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    beforeSend: (event) => scrubSensitive(event),
    beforeBreadcrumb: (breadcrumb) => scrubSensitive(breadcrumb),
  });
}
