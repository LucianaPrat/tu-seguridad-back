import { ApiProperty } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';

export class SpaceSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'My Secure Space' })
  name!: string;

  @ApiProperty({
    enum: SpaceMemberRole,
    description: "The caller's role in this space",
  })
  role!: SpaceMemberRole;
}
