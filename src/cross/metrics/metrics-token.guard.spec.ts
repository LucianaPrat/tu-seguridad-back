import { ExecutionContext, HttpException } from '@nestjs/common';
import { EnvNames } from '../common/constants';
import { MetricsTokenGuard } from './metrics-token.guard';

describe('MetricsTokenGuard', () => {
  function guardFor(token?: string): MetricsTokenGuard {
    const config = {
      get: (key: string) =>
        key === EnvNames.METRICS_TOKEN ? token : undefined,
    };
    return new MetricsTokenGuard(config as never);
  }

  function contextWithHeader(value?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: value === undefined ? {} : { 'x-metrics-token': value },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows any request when METRICS_TOKEN is unset (dev)', () => {
    expect(guardFor(undefined).canActivate(contextWithHeader())).toBe(true);
  });

  it('allows a request with the matching token header', () => {
    expect(guardFor('secret').canActivate(contextWithHeader('secret'))).toBe(
      true,
    );
  });

  it('rejects a request with a wrong token', () => {
    expect(() =>
      guardFor('secret').canActivate(contextWithHeader('nope')),
    ).toThrow(HttpException);
  });

  it('rejects a request with no token header when one is required', () => {
    expect(() => guardFor('secret').canActivate(contextWithHeader())).toThrow(
      HttpException,
    );
  });
});
