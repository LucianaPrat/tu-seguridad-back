import { ApiProperty } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import { MENU_KEYS, MenuKey } from '../../../cross/common/permissions';

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

  @ApiProperty({ enum: SpaceMemberRole })
  role!: SpaceMemberRole;

  @ApiProperty({ enum: MENU_KEYS, isArray: true })
  menuAccess!: MenuKey[];

  @ApiProperty({ type: [String] })
  cameraIds!: string[];

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty()
  createdAt!: Date;
}
