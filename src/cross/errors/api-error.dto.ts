import { ApiProperty } from '@nestjs/swagger';

import { ErrorCode } from '../common/constants';

/**
 * The body every failed request answers with. `EitherInterceptor` builds it from
 * the `Either` a service returned, so this class and the interceptor must agree.
 */
export class ApiErrorDto {
  @ApiProperty({
    example: 404,
    description: 'HTTP status, the same value as the response status line.',
  })
  statusCode!: number;

  @ApiProperty({
    enum: ErrorCode,
    example: ErrorCode.NOT_FOUND,
    description:
      'Stable machine-readable code. Branch on this, not on the message.',
  })
  code!: ErrorCode;

  @ApiProperty({
    example: 'Camera 7f3a not found',
    description:
      'Human-readable reason. Never carries credentials, tokens or snapshot URLs.',
  })
  message!: string;
}
