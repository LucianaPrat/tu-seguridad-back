import { ApiPropertyOptional } from '@nestjs/swagger';
import { ZoneEventType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class QueryEventsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cameraId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  zoneId?: string;

  @ApiPropertyOptional({ enum: ZoneEventType })
  @IsOptional()
  @IsEnum(ZoneEventType)
  eventType?: ZoneEventType;

  @ApiPropertyOptional({
    description: 'ISO 8601 date-time, occurredAt >= from',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 date-time, occurredAt <= to' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    default: 100,
    description: 'Silently clamped to [1, 1000]',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}
