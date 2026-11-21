import { ApiProperty } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthPolicy } from '../../../cross/common/constants';

export class InvitationPreviewQueryDto {
  @ApiProperty({ description: 'Opaque token from the delivered link' })
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_TOKEN_LENGTH)
  token!: string;
}

/** What the invitee may learn from the link alone, before signing in. */
export class InvitationPreviewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  spaceName!: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  invitedByName!: string;

  @ApiProperty({ example: 'member@example.com' })
  email!: string;

  @ApiProperty({ enum: SpaceMemberRole })
  role!: SpaceMemberRole;

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty({
    description:
      'Whether the address already has an account (sign in vs register).',
  })
  userExists!: boolean;
}

/** One entry of the signed-in caller's inbox. */
export class MyInvitationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  spaceId!: string;

  @ApiProperty()
  spaceName!: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  invitedByName!: string;

  @ApiProperty({ enum: SpaceMemberRole })
  role!: SpaceMemberRole;

  @ApiProperty()
  expiresAt!: Date;
}
