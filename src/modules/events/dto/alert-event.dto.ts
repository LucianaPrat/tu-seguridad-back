import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertType } from '@prisma/client';

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

  @ApiPropertyOptional({ type: Date, nullable: true })
  acknowledgedAt!: Date | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  acknowledgedByUserId!: number | null;
}
