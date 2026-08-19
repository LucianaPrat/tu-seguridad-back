import { ApiProperty } from '@nestjs/swagger';

/**
 * The deliberately uninformative answer of every route that must not reveal
 * whether its input matched anything: the magic-link and password-reset
 * requests, where a registered and an unregistered address get this same body,
 * and the inbound delivery acknowledgement, where a known, an already-used and
 * an unknown correlation id do.
 */
export class AcknowledgementDto {
  @ApiProperty({ example: true })
  accepted!: boolean;
}
