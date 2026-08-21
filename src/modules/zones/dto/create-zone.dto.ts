import { ApiProperty } from '@nestjs/swagger';
import { AlertType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, Max, Min } from 'class-validator';
import { ZoneGeometry } from '../../../cross/common/constants';

/**
 * A percentage arrives from a pixel drag divided by the frame size, so its
 * precision is whatever that division produced. The column is DECIMAL(5,2):
 * round here, before validation, so the rectangle checked is the rectangle
 * stored — rounding after the frame-bounds check could push `x + width` past
 * 100 and turn a valid request into a driver error.
 */
function toStoredPrecision({ value }: { value: unknown }): unknown {
  return typeof value === 'number'
    ? Number(value.toFixed(ZoneGeometry.DECIMAL_PLACES))
    : value;
}

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

  @ApiProperty({ enum: AlertType, description: 'Alert level this zone raises' })
  @IsEnum(AlertType)
  alertType!: AlertType;
}
