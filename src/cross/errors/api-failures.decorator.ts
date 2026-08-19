import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

import { ERROR_CODE_HTTP_STATUS, ErrorCode } from '../common/constants';
import { ApiErrorDto } from './api-error.dto';

/**
 * Documents the non-2xx answers a route can produce, one OpenAPI entry per HTTP
 * status.
 *
 * Codes that share a status are merged into a single entry, because two
 * `@ApiResponse` blocks on the same status silently overwrite each other. The
 * merge keeps both codes readable — each gets its own line — and narrows the
 * response's `code` to the ones this route can actually answer, so a generated
 * client sees `'VALIDATION_ERROR' | 'INVALID_ZONE'` on a zone write rather than
 * the whole `ErrorCode` enum.
 */
export function ApiFailures(reasons: Partial<Record<ErrorCode, string>>) {
  const byStatus = new Map<number, ErrorCode[]>();
  const lines = new Map<number, string[]>();

  for (const [code, reason] of Object.entries(reasons) as [
    ErrorCode,
    string,
  ][]) {
    const status = ERROR_CODE_HTTP_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
    lines.set(status, [
      ...(lines.get(status) ?? []),
      `\`${code}\` — ${reason}`,
    ]);
  }

  return applyDecorators(
    ApiExtraModels(ApiErrorDto),
    ...[...byStatus].map(([status, codes]) =>
      ApiResponse({
        status,
        description: lines.get(status)?.join('<br>'),
        schema: {
          allOf: [
            { $ref: getSchemaPath(ApiErrorDto) },
            { properties: { code: { type: 'string', enum: codes } } },
          ],
        },
      }),
    ),
  );
}
