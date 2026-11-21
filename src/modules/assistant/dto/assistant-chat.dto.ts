import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** The two roles a client is allowed to send. */
export const ASSISTANT_CLIENT_ROLES = ['user', 'assistant'] as const;
export type AssistantClientRole = (typeof ASSISTANT_CLIENT_ROLES)[number];

export const ASSISTANT_MAX_MESSAGES = 20;
export const ASSISTANT_MAX_CONTENT_LENGTH = 2000;

/**
 * One turn of the conversation, as the client replays it.
 *
 * `role` deliberately excludes `system`, which the upstream would accept: the
 * curated product context is sent as the one system message and a client able
 * to add its own could contradict it, or drop the product entirely and use an
 * authenticated help route as a general-purpose model on this project's bill.
 * The caps are the other half of that — the global rate limit is ten requests a
 * second, which is a billing problem rather than a limit.
 */
export class AssistantMessageDto {
  @ApiProperty({ enum: ASSISTANT_CLIENT_ROLES })
  @IsIn(ASSISTANT_CLIENT_ROLES)
  role!: AssistantClientRole;

  @ApiProperty({ maxLength: ASSISTANT_MAX_CONTENT_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ASSISTANT_MAX_CONTENT_LENGTH)
  content!: string;
}

/**
 * The whole conversation, every time. Nothing is stored server-side — the
 * history lives in the client, so a reload starts a fresh conversation and no
 * table, migration or retention sweep exists for it.
 */
export class AssistantChatRequestDto {
  @ApiProperty({
    type: [AssistantMessageDto],
    maxItems: ASSISTANT_MAX_MESSAGES,
    description:
      'The conversation so far, oldest first, ending with the new user message.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(ASSISTANT_MAX_MESSAGES)
  @ValidateNested({ each: true })
  @Type(() => AssistantMessageDto)
  messages!: AssistantMessageDto[];
}
