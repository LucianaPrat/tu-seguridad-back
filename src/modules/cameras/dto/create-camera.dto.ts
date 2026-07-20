import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateCameraDto {
  @ApiProperty({ example: 'camera_01', pattern: '^camera_[a-z0-9_]+$' })
  @Matches(/^camera_[a-z0-9_]+$/, {
    message: 'id must match /^camera_[a-z0-9_]+$/',
  })
  id!: string;

  @ApiProperty({ example: 'Front door' })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean = true;

  @ApiProperty({ example: 'http://user:pass@192.168.1.50/snapshot.jpg' })
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  snapshotUrl!: string;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 3600 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  pollingIntervalSeconds?: number = 5;

  @ApiPropertyOptional({ default: 0.45, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidenceThreshold?: number = 0.45;
}
