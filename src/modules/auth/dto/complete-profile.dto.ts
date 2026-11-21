import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  AuthPolicy,
  E164_PHONE_PATTERN,
} from '../../../cross/common/constants';

/**
 * What an invited account is missing: a name, a phone and a password of its own.
 * The placeholder hash it was created with is not usable for login, so the
 * password is required here rather than optional.
 */
export class CompleteProfileDto {
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

  @ApiProperty({ minLength: AuthPolicy.MIN_PASSWORD_LENGTH })
  @IsString()
  @MinLength(AuthPolicy.MIN_PASSWORD_LENGTH)
  @MaxLength(AuthPolicy.MAX_PASSWORD_LENGTH)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(AuthPolicy.MAX_AVATAR_URL_LENGTH)
  avatarUrl?: string;
}
