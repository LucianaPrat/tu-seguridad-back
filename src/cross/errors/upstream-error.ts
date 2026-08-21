import axios from 'axios';
import { ErrorCode } from '../common/constants';
import { buildError, Either } from './either';

/**
 * The axios-to-`Either` mapping every outbound client shares: a timeout is
 * `UPSTREAM_TIMEOUT`, anything else — a non-axios throw, an unreachable host, a
 * refusing upstream — is `UPSTREAM_ERROR`. `operation` is the label the message
 * opens with, so a caller reads "DVR snapshot fetch timed out".
 *
 * It lives here because the timeout heuristic is the kind that gets fixed in one
 * copy only: axios reports a client-side abort as `ECONNABORTED`, a connect
 * timeout as `ETIMEDOUT`, and some adapters only put the word in the message.
 * Clients keep their own branches on top of this — a digest challenge, a
 * credential the upstream itself refused, an open circuit — because those are
 * genuinely theirs.
 *
 * The thrown value is never logged and never rethrown: an axios error carries
 * the request body it was sent with, and for some callers that body holds a
 * recorder password. Only a status reaches the message.
 */
export const mapUpstreamError = <T>(
  error: unknown,
  operation: string,
): Either<T> => {
  if (!axios.isAxiosError(error)) {
    return buildError(ErrorCode.UPSTREAM_ERROR, `${operation} failed`);
  }

  if (
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT' ||
    error.message.includes('timeout')
  ) {
    return buildError(ErrorCode.UPSTREAM_TIMEOUT, `${operation} timed out`);
  }

  return buildError(
    ErrorCode.UPSTREAM_ERROR,
    `${operation} failed (status ${error.response?.status ?? 'unreachable'})`,
  );
};
