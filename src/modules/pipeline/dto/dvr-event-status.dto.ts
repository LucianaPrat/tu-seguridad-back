import { ApiProperty } from '@nestjs/swagger';

const DROP_REASONS = ['idle', 'error', 'closed'] as const;

/** The space recorder's event connection, as this API instance sees it. */
export class DvrEventStatusDto {
  @ApiProperty({
    description:
      'Whether the event listener is on (`DVR_EVENTS_ENABLED`). When it is off, ' +
      'nothing below is tracked and alerts come from polling alone.',
  })
  enabled!: boolean;

  @ApiProperty({
    description:
      'Event connection open. It closes after `DVR_EVENTS_IDLE_SECONDS` of silence, ' +
      'so `true` also means the recorder was heard from recently.',
  })
  connected!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the current connection opened or, while disconnected, since when the ' +
      'recorder has been unreachable. Null if it was never reached.',
  })
  since!: Date | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Last message of any kind. The recorder sends a heartbeat about every 10 s, ' +
      'so this moves even with no motion.',
  })
  lastHeardAt!: Date | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Last motion notification. Long gaps are normal at night or in an empty ' +
      'place; they do not mean the connection is broken.',
  })
  lastMotionAt!: Date | null;

  @ApiProperty({
    enum: DROP_REASONS,
    nullable: true,
    description:
      'Why the last connection ended: `idle` (went silent), `error` (refused, ' +
      'unreachable, bad credentials), `closed` (the recorder ended it).',
  })
  lastDrop!: (typeof DROP_REASONS)[number] | null;
}
