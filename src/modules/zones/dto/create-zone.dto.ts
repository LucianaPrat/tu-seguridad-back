import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { PointDto } from './point.dto';

export class CreateZoneDto {
  @ApiProperty({ example: 'zone_lobby', pattern: '^zone_[a-z0-9_]+$' })
  @Matches(/^zone_[a-z0-9_]+$/, {
    message: 'id must match /^zone_[a-z0-9_]+$/',
  })
  id!: string;

  @ApiProperty({ example: 'Lobby' })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean = true;

  @ApiProperty({ type: [PointDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  polygon!: PointDto[];
}
