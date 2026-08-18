import { ApiPropertyOptional } from '@nestjs/swagger';
import { AlertType, MonitorMode } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
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
}
