import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export const SPACE_NAME_MAX_LENGTH = 80;

/** Body of both `POST /spaces` and `PATCH /spaces/current`. */
export class SpaceNameDto {
  @ApiProperty({ example: 'Warehouse', maxLength: SPACE_NAME_MAX_LENGTH })
  // Trim first, so a name of spaces fails MinLength instead of being stored.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(SPACE_NAME_MAX_LENGTH)
  name!: string;
}
