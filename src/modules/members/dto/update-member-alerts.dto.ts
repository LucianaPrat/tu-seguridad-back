import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateMemberAlertsDto {
  @ApiProperty()
  @IsBoolean()
  receiveAlerts!: boolean;
}
