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
  ) as Record<
    string,
    {
      description: string;
      schema: {
        allOf: [unknown, { properties: { code: { enum: string[] } } }];
      };
    }
  >;

  it('merges codes that share an HTTP status into one response entry', () => {
    const badRequest =
      responses[ERROR_CODE_HTTP_STATUS[ErrorCode.INVALID_ZONE]];

    expect(Object.keys(responses)).toHaveLength(2);
    expect(badRequest.description).toContain(ErrorCode.VALIDATION_ERROR);
    expect(badRequest.description).toContain(ErrorCode.INVALID_ZONE);
  });

  it('points every failure at the shared error schema', () => {
    for (const response of Object.values(responses)) {
      expect(response.schema.allOf[0]).toEqual({
        $ref: `#/components/schemas/${ApiErrorDto.name}`,
      });
    }
  });

  it('narrows each response to the codes that route can actually answer', () => {
    const badRequest =
      responses[ERROR_CODE_HTTP_STATUS[ErrorCode.INVALID_ZONE]];
    const notFound = responses[ERROR_CODE_HTTP_STATUS[ErrorCode.NOT_FOUND]];

    expect(badRequest.schema.allOf[1].properties.code.enum).toEqual([
      ErrorCode.VALIDATION_ERROR,
      ErrorCode.INVALID_ZONE,
    ]);
    expect(notFound.schema.allOf[1].properties.code.enum).toEqual([
      ErrorCode.NOT_FOUND,
    ]);
  });
});
