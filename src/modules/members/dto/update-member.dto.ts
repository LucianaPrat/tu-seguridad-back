import { ApiPropertyOptional } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  AuthPolicy,
  E164_PHONE_PATTERN,
} from '../../../cross/common/constants';
import { MENU_KEYS, MenuKey } from '../../../cross/common/permissions';

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: SpaceMemberRole })
  @IsOptional()
  @IsEnum(SpaceMemberRole)
  role?: SpaceMemberRole;

  @ApiPropertyOptional({
    enum: MENU_KEYS,
    isArray: true,
    description:
      'Replaces the list. When only `role` changes, reset to that role defaults.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(MENU_KEYS, { each: true })
  menuAccess?: MenuKey[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Replaces the list. Cameras of this space; only read for guests.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  cameraIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  receiveAlerts?: boolean;

  @ApiPropertyOptional({
    example: 'Ada',
    description: 'Profile fields only apply to a user of this space alone.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_NAME_LENGTH)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Lovelace' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_NAME_LENGTH)
  lastName?: string;

  @ApiPropertyOptional({ example: '+5491122334455', description: 'E.164' })
  @IsOptional()
  @Matches(E164_PHONE_PATTERN, {
    message: 'phone must be an E.164 number, e.g. +5491122334455',
  })
  phone?: string;

  @ApiPropertyOptional({
    example: 'member@example.com',
    description: 'A change revokes every session of the user.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
