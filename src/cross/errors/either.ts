import { ErrorCode } from '../common/constants';

export type Either<T> =
  { ok: true; data: T } | { ok: false; code: ErrorCode; message?: string };

export const buildData = <T>(data: T): Either<T> => ({ ok: true, data });

export const buildError = <T>(
  code: ErrorCode,
  message?: string,
): Either<T> => ({
  ok: false,
  code,
  message,
});
