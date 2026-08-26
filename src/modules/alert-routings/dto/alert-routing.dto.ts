import { ApiProperty } from '@nestjs/swagger';
import { AlertChannel, AlertType } from '@prisma/client';
import { IsBoolean, IsEnum } from 'class-validator';

/**
 * One checkbox cell of the routing grid: an alert type crossed with a
 * channel, and whether that channel fires for that alert. The request cell
 * and the response cell carry the same three fields, so a single class
 * serves both `GET` and `PUT` rather than duplicating it per direction.
 */
export class AlertRoutingDto {
  @ApiProperty({ enum: AlertType })
  @IsEnum(AlertType)
  alertType!: AlertType;

  @ApiProperty({ enum: AlertChannel })
  @IsEnum(AlertChannel)
  channel!: AlertChannel;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}
