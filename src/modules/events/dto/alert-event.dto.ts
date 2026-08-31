import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertChannel, AlertType } from '@prisma/client';

/**
 * One row of the history screen. `cameraLabel` is the label copied at detection
 * time, not a join: renaming or deleting a camera must not rewrite what an
 * operator was told, and a purged camera leaves `cameraId` null while the label
 * survives.
 *
 * The frame is reached through `snapshotUrl`, the same space-scoped route the
 * camera detail uses. No recorder URL and no correlation id appear here — the
 * second is the token a provider callback authenticates with.
 */
export class AlertEventDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  cameraId!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Null when the camera monitors the full frame',
  })
  zoneId!: string | null;

  @ApiProperty({ example: 'Camera 01 – Front gate' })
  cameraLabel!: string;

  @ApiProperty({ enum: AlertType })
  alertType!: AlertType;

  @ApiProperty()
  detectedAt!: Date;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Authenticated URL of the frame the alert was raised on',
  })
  snapshotUrl!: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Anchors inside the area on the frame that raised the alert. Null on an ' +
      'alert recorded before the pipeline stored it.',
  })
  personsDetected!: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 0.913,
    description:
      'Highest detection score among those anchors, 0-1. Null on an alert ' +
      'recorded before the pipeline stored it.',
  })
  confidence!: number | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  acknowledgedAt!: Date | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  acknowledgedByUserId!: number | null;

  /**
   * The distinct set of channels the alert's deliveries used, not one entry
   * per delivery. Empty when no delivery was planned yet.
   */
  @ApiProperty({ enum: AlertChannel, isArray: true })
  channels!: AlertChannel[];
}
