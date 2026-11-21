import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { AlertRoutingDto } from './alert-routing.dto';

/**
 * The whole matrix, read or written in one shot. Used both as the `GET`
 * response and the `PUT` body — the screen always renders and saves the
 * full grid, so the two directions share this one shape rather than a
 * request/response pair that would only drift apart.
 */
export class AlertRoutingListDto {
  @ApiProperty({ type: [AlertRoutingDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6) // 2 alert types x 3 channels = the whole matrix
  @ValidateNested({ each: true })
  @Type(() => AlertRoutingDto)
  items!: AlertRoutingDto[];
}
