import { ApiProperty } from '@nestjs/swagger';
import { AlertType } from '@prisma/client';
import { IsEnum, IsNumber, Max, Min } from 'class-validator';
import { ZoneGeometry } from '../../../cross/common/constants';

export class CreateZoneDto {
  @ApiProperty({ example: 12.5 })
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  x!: number;

  @ApiProperty({ example: 20 })
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  y!: number;

  @ApiProperty({ example: 30 })
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  width!: number;

  @ApiProperty({ example: 40 })
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  height!: number;

  @ApiProperty({ enum: AlertType, description: 'Alert level this zone raises' })
  @IsEnum(AlertType)
  alertType!: AlertType;
}
