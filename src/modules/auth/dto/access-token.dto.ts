import { ApiProperty } from '@nestjs/swagger';

/**
 * Login and refresh responses. The refresh token is deliberately absent — it
 * ships as an HttpOnly cookie instead.
 */
export class AccessTokenDto {
  @ApiProperty()
  accessToken!: string;
}
