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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ZoneGeometry } from '../../../cross/common/constants';
import { toStoredPrecision } from '../stored-precision';
import { PointDto } from './point.dto';

/**
 * The box is a request field only for a rectangular zone. An outline already
 * carries the shape and the box is re-derived from it, so requiring one anyway
 * would force the client to invent a value the server then throws away.
 */
const hasNoOutline = (dto: CreateZoneDto): boolean => dto.points == null;

const BOX_REQUIRED = 'Required unless `points` is sent.';

export class CreateZoneDto {
  @ApiPropertyOptional({
    example: 12.5,
    description: `Percent of frame width. ${BOX_REQUIRED}`,
  })
  @ValidateIf(hasNoOutline)
  @Transform(toStoredPrecision)
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  x!: number;

  @ApiPropertyOptional({
    example: 20,
    description: `Percent of frame height. ${BOX_REQUIRED}`,
  })
  @ValidateIf(hasNoOutline)
  @Transform(toStoredPrecision)
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  y!: number;

  @ApiPropertyOptional({ example: 30, description: BOX_REQUIRED })
  @ValidateIf(hasNoOutline)
  @Transform(toStoredPrecision)
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  width!: number;

  @ApiPropertyOptional({ example: 40, description: BOX_REQUIRED })
  @ValidateIf(hasNoOutline)
  @Transform(toStoredPrecision)
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  height!: number;

  @ApiPropertyOptional({
    type: [PointDto],
    nullable: true,
    description:
      'Free-hand outline, percent of frame. When present it is the shape of the zone, and x/y/width/height are re-derived from it as its bounding box. Explicit `null` on an update clears the outline and leaves the rectangle as the shape.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(ZoneGeometry.MIN_OUTLINE_POINTS)
  @ArrayMaxSize(ZoneGeometry.MAX_OUTLINE_POINTS)
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  points?: PointDto[] | null;

  @ApiProperty({ enum: AlertType, description: 'Alert level this zone raises' })
  @IsEnum(AlertType)
  alertType!: AlertType;
}
