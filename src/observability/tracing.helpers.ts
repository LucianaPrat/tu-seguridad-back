/**
 * No-op stub until T18 wires real OpenTelemetry spans. Call sites (face-auth
 * client, pipeline) already depend on this signature so T18 only needs to
 * replace the implementation.
 */
export async function withSpan<T>(
  _name: string,
  _attributes: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  return fn();
}
