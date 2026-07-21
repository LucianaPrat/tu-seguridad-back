import { withSpan } from './tracing.helpers';

describe('withSpan (OTel disabled - default no-op tracer)', () => {
  it('returns the wrapped function result', async () => {
    const result = await withSpan('test.span', { foo: 'bar' }, () =>
      Promise.resolve(42),
    );

    expect(result).toBe(42);
  });

  it('propagates a rejection from the wrapped function', async () => {
    await expect(
      withSpan('test.span', {}, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });

  it('does not swallow synchronous throws either', async () => {
    await expect(
      withSpan('test.span', {}, () => {
        throw new Error('sync boom');
      }),
    ).rejects.toThrow('sync boom');
  });
});
