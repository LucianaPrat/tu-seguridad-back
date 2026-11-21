import { HttpException } from '@nestjs/common';
import { ERROR_CODE_HTTP_STATUS, ErrorCode } from '../common/constants';

/**
 * Guards run before the `EitherInterceptor`, so they cannot return an `Either`
 * and have to throw. This keeps their body identical to the one every other
 * failure path emits: `{ statusCode, code, message }`, status taken from the
 * same map, never written at the throw site.
 *
 * `message` is optional because a guard that rejects by mapping an `Either`
 * carries that type's optional message straight through; every caller today
 * passes one, and an absent message drops out of the JSON rather than becoming
 * the string "undefined".
 */
export function buildGuardException(
  code: ErrorCode,
  message?: string,
): HttpException {
  const statusCode = ERROR_CODE_HTTP_STATUS[code];
  return new HttpException({ statusCode, code, message }, statusCode);
}
