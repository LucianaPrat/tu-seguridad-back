import { ApiProperty } from '@nestjs/swagger';
import { Point } from '../geometry';
import { PointDto } from './point.dto';

export class ZoneDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  cameraId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ type: [PointDto] })
  polygon!: Point[];

  @ApiProperty()
  geometryVersion!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
