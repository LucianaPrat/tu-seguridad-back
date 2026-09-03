import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorCode } from '../../cross/common/constants';
import { AssistantThrottle } from '../../cross/decorators/route-throttle.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { AssistantService } from './assistant.service';
import { AssistantChatResponseDto } from './dto/assistant-chat-response.dto';
import { AssistantChatRequestDto } from './dto/assistant-chat.dto';

@ApiTags('assistant')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('chat')
  // Answers, creates nothing — and `@ApiOkResponse` already promises 200, which
  // Nest's default 201 for a POST would have made a lie in the contract.
  @HttpCode(HttpStatus.OK)
  @AssistantThrottle()
  @ApiOperation({
    summary: 'Ask the in-app help assistant',
    description:
      'Answers a question about using this product. Bearer, and open to any member — a member needs help as much as an admin does. The conversation is not stored: the client sends every turn it wants remembered, and the product context is prepended server-side as the system message, which is why a client may only send `user` and `assistant` roles. Answers in the language it was asked in. `CONFLICT` when the assistant is not enabled on the deployment.',
  })
  @ApiOkResponse({ type: AssistantChatResponseDto })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Malformed body — empty conversation, more than 20 messages, a message over 2000 characters, or a role other than `user`/`assistant`.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.CONFLICT]: 'The assistant is not enabled on this deployment.',
    [ErrorCode.UPSTREAM_ERROR]:
      'The assistant gateway refused the call or answered a body that carries no reply.',
    [ErrorCode.UPSTREAM_TIMEOUT]:
      'The assistant gateway did not answer in time.',
  })
  chat(
    @Body() dto: AssistantChatRequestDto,
  ): Promise<Either<AssistantChatResponseDto>> {
    return this.assistantService.chat(dto);
  }
}
