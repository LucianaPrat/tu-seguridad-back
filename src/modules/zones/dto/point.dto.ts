import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';
import { ZoneGeometry } from '../../../cross/common/constants';
import { toStoredPrecision } from '../stored-precision';

/** One vertex of a zone outline, in percent of the frame. */
export class PointDto {
  @ApiProperty({ example: 12.5, description: 'Percent of frame width' })
  @Transform(toStoredPrecision)
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  x!: number;

  @ApiProperty({ example: 20, description: 'Percent of frame height' })
  @Transform(toStoredPrecision)
  @IsNumber({ maxDecimalPlaces: ZoneGeometry.DECIMAL_PLACES })
  @Min(ZoneGeometry.MIN_PERCENT)
  @Max(ZoneGeometry.MAX_PERCENT)
  y!: number;
}
