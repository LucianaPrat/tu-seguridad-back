import { ApiProperty } from '@nestjs/swagger';

/**
 * Internal shape only. No route answers it: `refreshToken` leaves the process as
 * an HttpOnly cookie, never in a body — see `AccessTokenDto`.
 */
export class TokenPairDto {
  @ApiProperty({
    description: 'Bearer token for the `Authorization` header.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI...',
  })
  accessToken!: string;

  @ApiProperty({
    description:
      'Rotation token. Set as an HttpOnly, path-scoped cookie — never returned in a response body.',
  })
  refreshToken!: string;
}
