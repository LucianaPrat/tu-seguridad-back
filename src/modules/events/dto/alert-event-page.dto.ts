import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertEventDto } from './alert-event.dto';

export class AlertEventPageDto {
  @ApiProperty({ type: [AlertEventDto] })
  items!: AlertEventDto[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Opaque cursor for the next page; null when the last page was returned',
  })
  nextCursor!: string | null;
}
