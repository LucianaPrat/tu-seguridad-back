import { Attributes, SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('tu-seguridad-back');

/**
 * Wraps fn in a span named `name`. When OTel is disabled (tracing.ts never
 * registered a real SDK), @opentelemetry/api's default tracer is a no-op, so
 * this reduces to just calling fn() - no env checks needed here.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
