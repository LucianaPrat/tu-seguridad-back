import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';

/**
 * The space context every screen needs after login. Flat on purpose: the
 * frontend reads `role` as a string today. The space fields are null for an account
 * that belongs to no space yet.
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

  @ApiProperty({ format: 'uuid', nullable: true })
  spaceId!: string | null;

  @ApiProperty({ example: 'My Secure Space', nullable: true })
  spaceName!: string | null;

  @ApiProperty({
    enum: SpaceMemberRole,
    example: SpaceMemberRole.admin,
    nullable: true,
  })
  role!: SpaceMemberRole | null;

  @ApiProperty({ description: 'Whether this member receives alert deliveries' })
  receiveAlerts!: boolean;
}
