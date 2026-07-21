import { ApiProperty } from '@nestjs/swagger';

export class CameraDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ description: 'Masked as "***" on list responses' })
  snapshotUrl!: string;

  @ApiProperty()
  pollingIntervalSeconds!: number;

  @ApiProperty()
  confidenceThreshold!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
