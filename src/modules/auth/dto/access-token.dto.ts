import { ApiProperty } from '@nestjs/swagger';

/**
 * Login and refresh responses. The refresh token is deliberately absent — it
 * ships as an HttpOnly cookie instead.
 */
export class AccessTokenDto {
  @ApiProperty({
    description:
      'Bearer token for the `Authorization` header. Short-lived — rotate through ' +
      '`POST /auth/refresh` when it expires.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI...',
  })
  accessToken!: string;
}
