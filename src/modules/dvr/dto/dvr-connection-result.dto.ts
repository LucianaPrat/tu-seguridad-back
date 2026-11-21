import { ApiProperty } from '@nestjs/swagger';

/**
 * Outcome of a connectivity probe. The 200 itself is the success signal; the
 * count is there so the operator sees the recorder actually exposed channels
 * rather than answering an empty list.
 */
export class DvrConnectionResultDto {
  @ApiProperty({
    description: 'Channels the recorder listed. Nothing is stored.',
  })
  channelCount!: number;
}
