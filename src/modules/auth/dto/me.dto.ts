import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';

/**
 * The space context every screen needs after login. Flat on purpose: the
 * frontend reads `role` as a string today, and a caller has exactly one space.
 */
export class MeDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ example: 'owner@example.com' })
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ example: '+5491122334455' })
  phone!: string;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({
    description:
      'False until an invited member completes name, phone and password',
  })
  profileCompleted!: boolean;

  @ApiProperty({ format: 'uuid' })
  spaceId!: string;

  @ApiProperty({ example: 'My Secure Space' })
  spaceName!: string;

  @ApiProperty({ enum: SpaceMemberRole, example: SpaceMemberRole.admin })
  role!: SpaceMemberRole;

  @ApiProperty({ description: 'Whether this member receives alert deliveries' })
  receiveAlerts!: boolean;
}
