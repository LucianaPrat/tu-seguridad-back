import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The recorder as the UI sees it. The password never appears here, in any form. */
export class DvrDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ example: 'America/Argentina/Buenos_Aires' })
  timezone!: string;

  @ApiPropertyOptional({ type: Date, nullable: true })
  lastTestAt!: Date | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  lastTestOk!: boolean | null;

  @ApiProperty({ description: 'Cameras currently discovered on this recorder' })
  cameraCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
