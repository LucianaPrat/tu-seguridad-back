import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PolygonViolationDto {
  @ApiProperty()
  rule!: string;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional()
  index?: number;
}

export class ValidatePolygonResultDto {
  @ApiProperty()
  valid!: boolean;

  @ApiProperty({ type: [PolygonViolationDto] })
  violations!: PolygonViolationDto[];
}
