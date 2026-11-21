import { ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { MetricsThrottlerGuard } from './metrics-throttler.guard';

describe('MetricsThrottlerGuard', () => {
  it('increments the rejection counter when throwing a 429', async () => {
    const counter = { inc: jest.fn() };
    const guard = new MetricsThrottlerGuard(
      { throttlers: [] },
      {} as never,
      {} as never,
      counter as never,
    );
    const context = {
      switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
      getClass: () => ({ name: 'X' }),
      getHandler: () => ({ name: 'y' }),
    } as unknown as ExecutionContext;

    const invoke = guard as unknown as {
      throwThrottlingException: (
        c: ExecutionContext,
        d: unknown,
      ) => Promise<void>;
    };

    await expect(
      invoke.throwThrottlingException(context, {}),
    ).rejects.toBeInstanceOf(ThrottlerException);
    expect(counter.inc).toHaveBeenCalledTimes(1);
  });
});
