import { ApiProperty } from '@nestjs/swagger';

export class AssistantTranscribeResponseDto {
  @ApiProperty({
    description:
      'The transcript, as plain text. No model field beside it, unlike the chat answer: the speech model is not echoed back because nothing on the client varies with it.',
  })
  text!: string;
}
