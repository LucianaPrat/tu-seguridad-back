import { ApiPropertyOptional } from '@nestjs/swagger';
import { AlertType, MonitorMode } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { AuthPolicy } from '../../../cross/common/constants';

/**
 * Only operator-editable fields. `externalId` and `status` are deliberately
 * absent — the first is the recorder's key for this channel and the second is
 * an observation — and `forbidNonWhitelisted` turns an attempt to send either
 * into a 400 rather than a silently ignored field.
 */
export class UpdateCameraDto {
  @ApiPropertyOptional({ example: 'Front door' })
  @IsOptional()
  @IsString()
  @Length(1, AuthPolicy.MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({ example: 'Street side' })
  @IsOptional()
  @IsString()
  @Length(1, AuthPolicy.MAX_NAME_LENGTH)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ enum: MonitorMode })
  @IsOptional()
  @IsEnum(MonitorMode)
  monitorMode?: MonitorMode;

  @ApiPropertyOptional({
    enum: AlertType,
    description: 'Required when monitorMode is full',
  })
  @IsOptional()
  @IsEnum(AlertType)
  alertType?: AlertType;

  @ApiPropertyOptional({
    example: 0.6,
    minimum: 0.001,
    maximum: 1,
    nullable: true,
    description:
      'Detection score a person must reach on this camera. Null restores the ' +
      'deployment default. Three decimals; a street and a hallway need ' +
      'different numbers, and one used to detune the other.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1)
  confidenceThreshold?: number | null;

  @ApiPropertyOptional({
    example: 30,
    nullable: true,
    description:
      'Floor on how often this camera is polled, in seconds. Null lets the ' +
      'cadence ladder decide. Raises the floor only: it can never make a ' +
      'camera poll faster than the ladder would, and it is refused below the ' +
      "ladder's fastest rung rather than silently ignored.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  minPollSeconds?: number | null;
}
