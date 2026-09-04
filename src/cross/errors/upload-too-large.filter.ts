import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { PayloadTooLargeException } from '@nestjs/common';
import { Response } from 'express';
import { ERROR_CODE_HTTP_STATUS, ErrorCode } from '../common/constants';

/**
 * Multer refuses an oversized upload before the handler runs, so the failure
 * never reaches a service and never becomes an `Either`. Nest turns it into a
 * `PayloadTooLargeException`, which `EitherInterceptor` rethrows untouched —
 * right on both counts (it is a client error, and Sentry must not see it) but
 * shaped unlike every other error this API answers.
 *
 * This puts it back in the envelope, under the same `VALIDATION_ERROR` the
 * in-service size check already answers. One limit, one code, one contract: a
 * caller cannot tell whether the upload was refused before or after buffering,
 * and has no reason to care.
 *
 * It lives in `cross/` rather than beside one route because two now share it —
 * the camera frame upload and the assistant voice clip — and the message says
 * "file" for exactly that reason: a copy of the class per module would be one
 * word of difference and two places to fix the next one.
 */
@Catch(PayloadTooLargeException)
export class UploadTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    const status = ERROR_CODE_HTTP_STATUS[ErrorCode.VALIDATION_ERROR];
    host.switchToHttp().getResponse<Response>().status(status).json({
      statusCode: status,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'File is larger than the accepted size limit',
    });
  }
}
