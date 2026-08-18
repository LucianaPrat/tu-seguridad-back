import { ApiProperty } from '@nestjs/swagger';

/**
 * The deliberately uninformative answer of the magic-link and password-reset
 * request routes. A registered and an unregistered address get this same body, so
 * the API cannot be used to enumerate accounts.
 */
export class AcknowledgementDto {
  @ApiProperty({ example: true })
  accepted!: boolean;
}
