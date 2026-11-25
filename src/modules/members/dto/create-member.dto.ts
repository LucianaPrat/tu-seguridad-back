import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Locale, SpaceMemberRole } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
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

export class CreateMemberDto {
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
    description: 'Cameras of this space the member may see. Defaults to none.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  cameraIds?: string[];

  @ApiPropertyOptional({
    enum: Locale,
    description:
      "Language of a new account. Defaults to the admin's own locale; ignored for an existing account.",
  })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;

  @ApiPropertyOptional({
    example: 'Ada',
    description: 'Required for a new user, ignored for an existing one.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_NAME_LENGTH)
  firstName?: string;

  @ApiPropertyOptional({
    example: 'Lovelace',
    description: 'Required for a new user, ignored for an existing one.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_NAME_LENGTH)
  lastName?: string;

  @ApiPropertyOptional({
    example: '+5491122334455',
    description: 'E.164. Required for a new user, ignored for an existing one.',
  })
  @IsOptional()
  @Matches(E164_PHONE_PATTERN, {
    message: 'phone must be an E.164 number, e.g. +5491122334455',
  })
  phone?: string;

  @ApiPropertyOptional({
    minLength: AuthPolicy.MIN_PASSWORD_LENGTH,
    description: 'Required for a new user, never applied to an existing one.',
  })
  @IsOptional()
  @IsString()
  @MinLength(AuthPolicy.MIN_PASSWORD_LENGTH)
  @MaxLength(AuthPolicy.MAX_PASSWORD_LENGTH)
  password?: string;
}
