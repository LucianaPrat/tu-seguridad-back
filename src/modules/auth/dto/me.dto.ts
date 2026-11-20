import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Locale, SpaceMemberRole } from '@prisma/client';
import type { MenuKey } from '../../../cross/common/permissions';
import { MENU_KEYS } from '../../../cross/common/permissions';
import { SpaceSummaryDto } from '../../spaces/dto/space-summary.dto';

export class CurrentSpaceDto extends SpaceSummaryDto {
  @ApiProperty({
    description:
      'Whether the space has a recorder configured; replaces probing `GET /dvr`, which needs the dvr section.',
  })
  hasDvr!: boolean;

  @ApiProperty({ enum: MENU_KEYS, isArray: true })
  menuAccess!: MenuKey[];

  @ApiProperty({
    type: String,
    isArray: true,
    description: 'Cameras a guest may see; empty for other roles',
  })
  cameraIds!: string[];
}

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

  @ApiProperty({ enum: Locale, description: 'UI and mail language' })
  locale!: Locale;

  @ApiProperty({
    description:
      'False until an invited member completes name, phone and password',
  })
  profileCompleted!: boolean;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    deprecated: true,
    description: 'Deprecated: use `currentSpace`.',
  })
  spaceId!: string | null;

  @ApiProperty({
    example: 'My Secure Space',
    nullable: true,
    deprecated: true,
    description: 'Deprecated: use `currentSpace`.',
  })
  spaceName!: string | null;

  @ApiProperty({
    enum: SpaceMemberRole,
    example: SpaceMemberRole.admin,
    nullable: true,
    deprecated: true,
    description: 'Deprecated: use `currentSpace`.',
  })
  role!: SpaceMemberRole | null;

  @ApiProperty({ description: 'Whether this member receives alert deliveries' })
  receiveAlerts!: boolean;

  @ApiProperty({
    type: SpaceSummaryDto,
    isArray: true,
    description: 'Every space the account belongs to',
  })
  spaces!: SpaceSummaryDto[];

  @ApiProperty({
    type: CurrentSpaceDto,
    nullable: true,
    description: 'The space the session is in; null when the account has none',
  })
  currentSpace!: CurrentSpaceDto | null;

  @ApiProperty({
    description: 'Open invitations addressed to the account email',
  })
  pendingInvitationsCount!: number;
}
