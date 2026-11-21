import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * OpenAI's own `/v1/audio/speech` input cap. Matched rather than invented —
 * this route proxies to that exact contract shape, so a longer body would only
 * be refused one hop later.
 *
 * Deliberately not `ASSISTANT_MAX_CONTENT_LENGTH`: that one bounds a question a
 * person typed, this one bounds an answer a model wrote, and an answer can
 * legitimately run longer than the question that produced it.
 */
export const ASSISTANT_MAX_TTS_INPUT_LENGTH = 4096;

export class AssistantSpeakDto {
  @ApiProperty({
    maxLength: ASSISTANT_MAX_TTS_INPUT_LENGTH,
    description: 'The text to read aloud, usually an assistant reply.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ASSISTANT_MAX_TTS_INPUT_LENGTH)
  text!: string;
}
