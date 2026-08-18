import { ApiProperty } from '@nestjs/swagger';
import { AlertType } from '@prisma/client';

/**
 * A monitored rectangle, in percent of the frame. Percent and not pixels: the
 * recorder's resolution or the snapshot size can change without invalidating
 * what the operator drew.
 */
export class MonitorZoneDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  cameraId!: string;

  @ApiProperty({ example: 12.5, description: 'Percent of frame width' })
  x!: number;

  @ApiProperty({ example: 20, description: 'Percent of frame height' })
  y!: number;

  @ApiProperty({ example: 30 })
  width!: number;

  @ApiProperty({ example: 40 })
  height!: number;

  @ApiProperty({ enum: AlertType })
  alertType!: AlertType;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
