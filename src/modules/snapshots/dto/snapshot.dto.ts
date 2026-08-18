import { ApiProperty } from '@nestjs/swagger';

/**
 * A stored frame as JSON. The bytes are never part of it: they are served by
 * `GET /snapshots/:id`, which re-checks the caller's space before answering.
 */
export class SnapshotDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  cameraId!: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType!: string;

  @ApiProperty()
  byteSize!: number;

  @ApiProperty()
  capturedAt!: Date;

  @ApiProperty({
    description: 'Authenticated, space-scoped URL the bytes are read from',
    example: '/api/v1/snapshots/1f0c7d1e-0000-4000-8000-000000000000',
  })
  url!: string;
}
