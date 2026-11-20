import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  AuthPolicy,
  E164_PHONE_PATTERN,
} from '../../../cross/common/constants';

/**
 * Self-registration: the account, its space, its `admin` membership and the
 * space's default routing matrix. With an `inviteToken` only the account is
 * created: the invitation, not a new space, is where the user is headed. The profile is complete from the start, so a
 * registered owner never sees the completion gate an invited member does.
 */
export class RegisterDto {
  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: AuthPolicy.MIN_PASSWORD_LENGTH })
  @IsString()
  @MinLength(AuthPolicy.MIN_PASSWORD_LENGTH)
  @MaxLength(AuthPolicy.MAX_PASSWORD_LENGTH)
  password!: string;

  @ApiProperty({ example: 'Ada' })
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_NAME_LENGTH)
  firstName!: string;

  @ApiProperty({ example: 'Lovelace' })
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_NAME_LENGTH)
  lastName!: string;

  @ApiProperty({ example: '+5491122334455', description: 'E.164' })
  @Matches(E164_PHONE_PATTERN, {
    message: 'phone must be an E.164 number, e.g. +5491122334455',
  })
  phone!: string;

  @ApiPropertyOptional({
    example: 'My Secure Space',
    description: 'Required unless registering with an inviteToken.',
  })
  @ValidateIf((dto: RegisterDto) => !dto.inviteToken)
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_SPACE_NAME_LENGTH)
  spaceName?: string;

  @ApiPropertyOptional({
    description:
      'Invitation token from the mailed link. The account is created with no space; ' +
      'accept the invitation afterwards.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_TOKEN_LENGTH)
  inviteToken?: string;

  @ApiPropertyOptional({
    enum: Locale,
    description: 'UI and mail language. Defaults to es.',
  })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;
}
