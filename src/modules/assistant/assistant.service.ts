import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { mapUpstreamError } from '../../cross/errors/upstream-error';
import { ASSISTANT_CONTEXT } from './assistant-context';
import { AssistantChatResponseDto } from './dto/assistant-chat-response.dto';
import { AssistantChatRequestDto } from './dto/assistant-chat.dto';

interface ChatCompletionChoice {
  message?: { content?: unknown };
}

interface ChatCompletionResponse {
  model?: unknown;
  choices?: ChatCompletionChoice[];
}

/**
 * The one usable answer shape: a first choice carrying non-empty text.
 *
 * Checked rather than trusted for the same reason the detection response is —
 * an unreadable body would otherwise reach the screen as a blank reply, which
 * looks like the assistant had nothing to say instead of like an outage.
 */
const replyOf = (body: unknown): string => {
  const content = (body as ChatCompletionResponse | null)?.choices?.[0]?.message
    ?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    return '';
  }
  return content;
};

/**
 * The in-app help assistant: one turn of chat against an OpenAI-compatible
 * gateway, with the product context prepended as the system message.
 *
 * Stateless by design — the client replays the conversation, so there is
 * nothing here to expire, scope to a space or sweep. What the service adds is
 * the context and the guarantee that it comes first.
 *
 * No circuit breaker, unlike the detection client: that one is called by a
 * scheduler several times a second with nobody watching, so an open circuit
 * saves real time. This is one interactive request behind a rate limit, and a
 * timeout already bounds it.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async chat(
    dto: AssistantChatRequestDto,
  ): Promise<Either<AssistantChatResponseDto>> {
    if (!this.configService.get<boolean>(EnvNames.ASSISTANT_ENABLED)) {
      return buildError(
        ErrorCode.CONFLICT,
        'the help assistant is not enabled on this deployment',
      );
    }

    const model = this.model();

    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(
          `${this.apiUrl()}/v1/chat/completions`,
          {
            model,
            messages: [
              { role: 'system', content: ASSISTANT_CONTEXT },
              ...dto.messages.map(({ role, content }) => ({ role, content })),
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${this.token()}`,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout(),
          },
        ),
      );

      const reply = replyOf(response.data);
      if (reply === '') {
        this.logger.warn('assistant gateway answered a body it cannot read');
        return buildError(
          ErrorCode.UPSTREAM_ERROR,
          'assistant chat answered no usable reply',
        );
      }

      return buildData({ reply, model });
    } catch (error) {
      return mapUpstreamError(error, 'assistant chat');
    }
  }

  private apiUrl(): string | undefined {
    return this.configService.get<string>(EnvNames.ASSISTANT_API_URL);
  }

  private token(): string | undefined {
    return this.configService.get<string>(EnvNames.ASSISTANT_API_TOKEN);
  }

  private model(): string {
    return this.configService.get<string>(EnvNames.ASSISTANT_MODEL) ?? '';
  }

  private timeout(): number | undefined {
    return this.configService.get<number>(EnvNames.ASSISTANT_TIMEOUT_MS);
  }
}
