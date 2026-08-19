import { ERROR_CODE_HTTP_STATUS, ErrorCode } from '../common/constants';
import { ApiErrorDto } from './api-error.dto';
import { ApiFailures } from './api-failures.decorator';

/** `@nestjs/swagger` does not export its metadata keys, and `exports` blocks the deep import. */
const API_RESPONSE_METADATA = 'swagger/apiResponse';

describe('ApiFailures', () => {
  class Target {
    @ApiFailures({
      [ErrorCode.VALIDATION_ERROR]: 'Body failed validation.',
      [ErrorCode.INVALID_ZONE]: 'Rectangle is out of bounds.',
      [ErrorCode.NOT_FOUND]: 'No such camera.',
    })
    handler(): void {}
  }

  const responses = Reflect.getMetadata(
    API_RESPONSE_METADATA,
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading decorator metadata off the method, never calling it
    Target.prototype.handler,
  ) as Record<string, { description: string; type: unknown }>;

  it('merges codes that share an HTTP status into one response entry', () => {
    const badRequest =
      responses[ERROR_CODE_HTTP_STATUS[ErrorCode.INVALID_ZONE]];

    expect(Object.keys(responses)).toHaveLength(2);
    expect(badRequest.description).toContain(ErrorCode.VALIDATION_ERROR);
    expect(badRequest.description).toContain(ErrorCode.INVALID_ZONE);
  });

  it('points every failure at the shared error schema', () => {
    expect(Object.values(responses).map((response) => response.type)).toEqual([
      ApiErrorDto,
      ApiErrorDto,
    ]);
  });
});
