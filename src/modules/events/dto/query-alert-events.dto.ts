import { ApiPropertyOptional } from '@nestjs/swagger';
import { AlertType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EventHistory } from '../../../cross/common/constants';

/** The two filters the history screen has, plus paging. */
export class QueryAlertEventsDto {
  @ApiPropertyOptional({ enum: AlertType })
  @IsOptional()
  @IsEnum(AlertType)
  alertType?: AlertType;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound on detectedAt, ISO 8601',
    example: '2026-08-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: EventHistory.MAX_PAGE_SIZE,
    default: EventHistory.DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EventHistory.MAX_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(EventHistory.MAX_CURSOR_LENGTH)
  cursor?: string;
}
