import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { PinoLogger } from 'nestjs-pino';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ERROR_CODE_HTTP_STATUS, ErrorCode } from '../common/constants';
import { buildData, buildError } from '../errors/either';
import { EitherInterceptor } from './either.interceptor';

jest.mock('@sentry/node');
const captureException = Sentry.captureException as jest.Mock;

describe('EitherInterceptor', () => {
  let interceptor: EitherInterceptor;
  let logger: { setContext: jest.Mock; error: jest.Mock };
  const context = {} as ExecutionContext;

  beforeEach(() => {
    logger = { setContext: jest.fn(), error: jest.fn() };
    interceptor = new EitherInterceptor(logger as unknown as PinoLogger);
    captureException.mockClear();
  });

  function handlerOf(value$: ReturnType<typeof of>): CallHandler {
    return { handle: () => value$ } as CallHandler;
  }

  async function expectRejection(handler: CallHandler): Promise<HttpException> {
    try {
      await firstValueFrom(interceptor.intercept(context, handler));
      throw new Error('expected the observable to reject');
    } catch (error) {
      return error as HttpException;
    }
  }

  it('unwraps an ok Either into its data', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(
        context,
        handlerOf(of(buildData({ hello: 'world' }))),
      ),
    );
    expect(result).toEqual({ hello: 'world' });
  });

  it('passes through plain (non-Either) results unchanged', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(context, handlerOf(of({ plain: true }))),
    );
    expect(result).toEqual({ plain: true });
  });

  it.each(Object.values(ErrorCode))(
    'maps ErrorCode.%s to its mapped HTTP status',
    async (code) => {
      const err = await expectRejection(
        handlerOf(of(buildError(code, 'boom'))),
      );

      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(ERROR_CODE_HTTP_STATUS[code]);
      expect(err.getResponse()).toEqual({
        statusCode: ERROR_CODE_HTTP_STATUS[code],
        code,
        message: 'boom',
      });
    },
  );

  it('maps an unexpected thrown Error to a 500 envelope without leaking internals', async () => {
    const err = await expectRejection(
      handlerOf(
        throwError(() => new Error('unexpected failure, do not leak me')),
      ),
    );

    expect(err.getStatus()).toBe(500);
    expect(err.getResponse()).toEqual({
      statusCode: 500,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    });
    expect(logger.error).toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('passes through an existing HttpException unchanged', async () => {
    const original = new HttpException('Unauthorized', 401);
    const err = await expectRejection(handlerOf(throwError(() => original)));

    expect(err).toBe(original);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('does not report Either failures to Sentry', async () => {
    await expectRejection(
      handlerOf(of(buildError(ErrorCode.NOT_FOUND, 'nope'))),
    );

    expect(captureException).not.toHaveBeenCalled();
  });
});
