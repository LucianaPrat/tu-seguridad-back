import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
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
 * Self-registration: the account, its space, its `admin` membership and the
 * space's default routing matrix. The profile is complete from the start, so a
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

  @ApiProperty({ example: 'My Secure Space' })
  @IsString()
  @MinLength(1)
  @MaxLength(AuthPolicy.MAX_SPACE_NAME_LENGTH)
  spaceName!: string;
}
