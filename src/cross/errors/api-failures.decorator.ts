import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

import { ERROR_CODE_HTTP_STATUS, ErrorCode } from '../common/constants';
import { ApiErrorDto } from './api-error.dto';

/**
 * Documents the non-2xx answers a route can produce, one OpenAPI entry per HTTP
 * status. Codes that share a status — `VALIDATION_ERROR` and `INVALID_ZONE` are
 * both 400 — are merged into a single entry, because two `@ApiResponse` blocks on
 * the same status would silently overwrite each other.
 */
export function ApiFailures(reasons: Partial<Record<ErrorCode, string>>) {
  const byStatus = new Map<number, string[]>();

  for (const [code, reason] of Object.entries(reasons) as [
    ErrorCode,
    string,
  ][]) {
    const status = ERROR_CODE_HTTP_STATUS[code];
    byStatus.set(status, [
      ...(byStatus.get(status) ?? []),
      `\`${code}\` — ${reason}`,
    ]);
  }

  return applyDecorators(
    ...[...byStatus].map(([status, reasonLines]) =>
      ApiResponse({
        status,
        description: reasonLines.join('<br>'),
        type: ApiErrorDto,
      }),
    ),
  );
}
