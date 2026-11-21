import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SwitchSpaceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  spaceId!: string;
}
