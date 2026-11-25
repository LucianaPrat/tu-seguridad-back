import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';

export const ACTIVITY_WINDOWS = [7, 30, 90] as const;
export const DEFAULT_ACTIVITY_DAYS = 30;

export class QueryMemberActivityDto {
  @ApiPropertyOptional({
    enum: ACTIVITY_WINDOWS,
    default: DEFAULT_ACTIVITY_DAYS,
    description: 'Window, in calendar days ending today in the space timezone',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(ACTIVITY_WINDOWS)
  days?: number;
}

export class AccessesByDayDto {
  @ApiProperty({ example: '2026-09-14' }) date!: string;
  @ApiProperty() userId!: number;
  @ApiProperty({ description: 'Sessions that started that day (always > 0)' })
  sessions!: number;
}

export class WatchByDayDto {
  @ApiProperty({ example: '2026-09-14' }) date!: string;
  @ApiProperty() cameraId!: string;
  @ApiProperty() minutes!: number;
}

export class WatchByUserCameraDto {
  @ApiProperty() userId!: number;
  @ApiProperty() cameraId!: string;
  @ApiProperty() minutes!: number;
}

export class LastAccessDto {
  @ApiProperty() userId!: number;
  @ApiProperty({
    description: 'ISO 8601 instant of the last authenticated hit',
  })
  at!: string;
}

export class PreviousPeriodDto {
  @ApiProperty() sessions!: number;
  @ApiProperty() activeUsers!: number;
  @ApiProperty() watchMinutes!: number;
}

export class MemberActivityDto {
  @ApiProperty({ example: 'America/Montevideo' })
  timezone!: string;
  @ApiProperty({
    type: [String],
    description: 'Every YYYY-MM-DD of the period, ascending',
  })
  days!: string[];
  @ApiProperty({ type: [AccessesByDayDto] })
  accessesByDay!: AccessesByDayDto[];
  @ApiProperty({ type: [WatchByDayDto] })
  watchByDay!: WatchByDayDto[];
  @ApiProperty({ type: [WatchByUserCameraDto] })
  watchByUserCamera!: WatchByUserCameraDto[];
  @ApiProperty({
    type: [LastAccessDto],
    description: 'All time; members with no hits are omitted',
  })
  lastAccess!: LastAccessDto[];
  @ApiProperty({ type: PreviousPeriodDto })
  previous!: PreviousPeriodDto;
}
