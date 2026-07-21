import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { PointDto } from './point.dto';

export class ValidateZoneDto {
  @ApiPropertyOptional({ type: [PointDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  polygon?: PointDto[];
}
