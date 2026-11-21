import { ApiProperty } from '@nestjs/swagger';

export class AssistantChatResponseDto {
  @ApiProperty({ description: "The assistant's answer, as plain text." })
  reply!: string;

  @ApiProperty({
    description:
      'The model that produced it, as the gateway reports it. Configured, not chosen per request — it is here so a changed deployment is visible in the answer rather than only in the environment.',
  })
  model!: string;
}
