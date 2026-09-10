import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One channel's outcome from `POST /dvr/event-linkage`. `outcome` is a TS
 * string-literal union, which Swagger would otherwise document as a bare
 * `string` — the explicit `enum` below is what keeps the committed contract
 * honest.
 */
export class DvrEventLinkageChannelDto {
  @ApiProperty()
  externalId!: string;

  @ApiProperty({ enum: ['linked', 'alreadyLinked', 'failed'] })
  outcome!: 'linked' | 'alreadyLinked' | 'failed';

  @ApiPropertyOptional({
    description:
      'Why the channel failed, or why it was never attempted. Absent on ' +
      'linked and alreadyLinked.',
  })
  detail?: string;
}

/**
 * Best-effort report of wiring the recorder's own VMD triggers to publish a
 * `center` notification, one row per channel the recorder currently lists, in
 * discovery order — a single verdict could not say which of several
 * independent per-channel writes actually took.
 */
export class DvrEventLinkageResultDto {
  @ApiProperty({ type: [DvrEventLinkageChannelDto] })
  channels!: DvrEventLinkageChannelDto[];
}
