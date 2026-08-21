import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ZoneGeometry } from '../../../cross/common/constants';
import { toStoredPrecision } from '../stored-precision';
import { PointDto } from './point.dto';

export class CreateZoneDto {
  @ApiProperty({ example: 12.5 })
  @Transform(toStoredPrecision)
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  x!: number;

  @ApiProperty({ example: 20 })
  @Transform(toStoredPrecision)
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  y!: number;

  @ApiProperty({ example: 30 })
  @Transform(toStoredPrecision)
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  width!: number;

  @ApiProperty({ example: 40 })
  @Transform(toStoredPrecision)
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  height!: number;

  @ApiPropertyOptional({
    type: [PointDto],
    description:
      'Free-hand outline, percent of frame. When present it is the shape of the zone, and x/y/width/height are re-derived from it as its bounding box.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(ZoneGeometry.MIN_OUTLINE_POINTS)
  @ArrayMaxSize(ZoneGeometry.MAX_OUTLINE_POINTS)
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  points?: PointDto[];

  @ApiProperty({ enum: AlertType, description: 'Alert level this zone raises' })
  @IsEnum(AlertType)
  alertType!: AlertType;
}
