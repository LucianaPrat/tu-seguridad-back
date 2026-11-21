import { ApiProperty } from '@nestjs/swagger';

/** Confirmation of an enrolled face identity. Never carries the token itself. */
export class FaceIdentityDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  createdAt!: Date;
}
