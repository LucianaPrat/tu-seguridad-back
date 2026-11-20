import { ApiProperty } from '@nestjs/swagger';
import { Locale } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateMeDto {
  @ApiProperty({ enum: Locale })
  @IsEnum(Locale)
  locale!: Locale;
}
