import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ZoneEventType } from '@prisma/client';

export class ZoneEventDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  eventId!: string;

  @ApiProperty({ enum: ZoneEventType })
  eventType!: ZoneEventType;

  @ApiProperty()
  cameraId!: string;

  @ApiProperty()
  zoneId!: string;

  @ApiProperty()
  occurredAt!: Date;

  @ApiPropertyOptional()
  confidence!: number | null;

  @ApiProperty()
  personsInZone!: number;

  @ApiPropertyOptional()
  anchor!: { x: number; y: number } | null;
}
