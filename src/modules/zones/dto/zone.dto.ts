import { ApiProperty } from '@nestjs/swagger';
import { AlertType } from '@prisma/client';
import { PointDto } from './point.dto';

/**
 * A monitored area, in percent of the frame. Percent and not pixels: the
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

  @ApiProperty({
    type: [PointDto],
    description:
      'Outline of the zone. A rectangular zone answers the four corners of its rectangle, so a client only ever draws one shape.',
  })
  points!: PointDto[];

  @ApiProperty({ enum: AlertType })
  alertType!: AlertType;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
