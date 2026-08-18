import { ApiProperty } from '@nestjs/swagger';

/**
 * What an administrator gets back after inviting somebody. The raw token is
 * absent by design: it exists only inside the delivered link, so an admin who can
 * read this response still cannot log in as the invitee.
 */
export class InvitationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'member@example.com' })
  email!: string;

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty()
  createdAt!: Date;
}
