import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertType, CameraStatus, MonitorMode } from '@prisma/client';

/**
 * Cameras are discovered from the recorder, never created by hand, so the DTO
 * separates what the DVR owns (`externalId`, `status`) from what the operator
 * owns (`name`, `location`, `isEnabled`, the monitor configuration). No field
 * here is secret-bearing: the recorder URL and its credentials stay server-side,
 * and the image is reached through `latestSnapshotUrl`.
 */
export class CameraDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'DVR channel identifier; stable across renames' })
  externalId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  location!: string | null;

  @ApiProperty({ enum: CameraStatus })
  status!: CameraStatus;

  @ApiProperty({ description: 'Monitor behavior saved and usable' })
  isConfigured!: boolean;

  @ApiProperty()
  isEnabled!: boolean;

  @ApiProperty({ enum: MonitorMode })
  monitorMode!: MonitorMode;

  @ApiPropertyOptional({
    enum: AlertType,
    nullable: true,
    description: 'Alert level for full-frame monitoring; zones carry their own',
  })
  alertType!: AlertType | null;

  @ApiPropertyOptional({
    type: Date,
    nullable: true,
    description: 'When the recorder last handed over a frame',
  })
  lastSnapshotAt!: Date | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Authenticated URL of the latest stored frame, if any',
  })
  latestSnapshotUrl!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
