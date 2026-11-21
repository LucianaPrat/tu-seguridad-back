import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertChannel, EventDeliveryStatus } from '@prisma/client';

/**
 * One outbound attempt. `correlationId` is deliberately absent: it is the value
 * the public acknowledgement route accepts, so returning it to any member would
 * let them acknowledge an alert they never received.
 */
export class EventDeliveryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  eventId!: string;

  @ApiProperty({ enum: AlertChannel })
  channel!: AlertChannel;

  @ApiProperty()
  recipientUserId!: number;

  @ApiProperty({ enum: EventDeliveryStatus })
  status!: EventDeliveryStatus;

  @ApiPropertyOptional({ type: Date, nullable: true })
  sentAt!: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  deliveredAt!: Date | null;

  @ApiPropertyOptional({
    type: Date,
    nullable: true,
    description: 'When the provider callback for this attempt arrived',
  })
  inboundReceivedAt!: Date | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  error!: string | null;

  @ApiProperty()
  createdAt!: Date;
}
