import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { MENU_KEYS, MenuKey } from '../../../cross/common/permissions';

export class CreateInvitationDto {
  @ApiProperty({ example: 'member@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: SpaceMemberRole })
  @IsEnum(SpaceMemberRole)
  role!: SpaceMemberRole;

  @ApiPropertyOptional({
    enum: MENU_KEYS,
    isArray: true,
    description: 'Defaults to the role defaults.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(MENU_KEYS, { each: true })
  menuAccess?: MenuKey[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Cameras of this space the invitee may see. Defaults to none.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  cameraIds?: string[];
}
