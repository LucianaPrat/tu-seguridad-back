import { ApiPropertyOptional } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import {
  IsEnum,
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

/** Every field is optional; an empty body changes nothing. Email is not editable. */
export class UpdateMeDto {
  @ApiPropertyOptional({ enum: Locale })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;

  @ApiPropertyOptional({ example: 'Ada' })
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
}
