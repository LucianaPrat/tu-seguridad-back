import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ERROR_CODE_HTTP_STATUS, ErrorCode } from '../common/constants';
import { Either } from '../errors/either';

function isEither(value: unknown): value is Either<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof value.ok === 'boolean'
  );
}

@Injectable()
export class EitherInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(EitherInterceptor.name);
  }

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((result: unknown) => {
        if (!isEither(result)) {
          return result;
        }
        if (result.ok) {
          return result.data;
        }
        throw new HttpException(
          {
            statusCode: ERROR_CODE_HTTP_STATUS[result.code],
            code: result.code,
            message: result.message,
          },
          ERROR_CODE_HTTP_STATUS[result.code],
        );
      }),
      catchError((error: unknown) => {
        if (error instanceof HttpException) {
          throw error;
        }
        this.logger.error({ err: error }, 'Unhandled exception');
        throw new HttpException(
          {
            statusCode: ERROR_CODE_HTTP_STATUS[ErrorCode.INTERNAL_ERROR],
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Internal server error',
          },
          ERROR_CODE_HTTP_STATUS[ErrorCode.INTERNAL_ERROR],
        );
      }),
    );
  }
}
