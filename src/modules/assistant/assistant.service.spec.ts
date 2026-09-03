import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { ASSISTANT_CONTEXT } from './assistant-context';
import { AssistantService } from './assistant.service';
import { AssistantChatRequestDto } from './dto/assistant-chat.dto';

const conversation: AssistantChatRequestDto = {
  messages: [
    { role: 'user', content: '¿Cómo agrego una zona?' },
    { role: 'assistant', content: 'Desde la cámara.' },
    { role: 'user', content: '¿Y si no la veo?' },
  ],
};

const completion = (content: unknown) =>
  of({ data: { choices: [{ message: { content } }] } });

describe('AssistantService', () => {
  let httpService: { post: jest.Mock };
  let config: Record<string, unknown>;
  let service: AssistantService;

  beforeEach(() => {
    httpService = { post: jest.fn().mockReturnValue(completion('Así.')) };
    config = {
      [EnvNames.ASSISTANT_ENABLED]: true,
      [EnvNames.ASSISTANT_API_URL]: 'https://llm.disier.net',
      [EnvNames.ASSISTANT_API_TOKEN]: 'sk-test',
      [EnvNames.ASSISTANT_MODEL]: 'vendor/model-0731',
      [EnvNames.ASSISTANT_TIMEOUT_MS]: 30000,
    };
    service = new AssistantService(
      httpService as never,
      {
        get: (name: string) => config[name],
      } as never,
    );
  });

  it('answers with the reply and the configured model', async () => {
    const result = await service.chat(conversation);

    expect(result).toEqual({
      ok: true,
      data: { reply: 'Así.', model: 'vendor/model-0731' },
    });
  });

  // The whole point of the route: the product context is the first message, and
  // the client's turns follow it in the order it sent them.
  it('prepends the product context and keeps the conversation order', async () => {
    await service.chat(conversation);

    expect(httpService.post).toHaveBeenCalledWith(
      'https://llm.disier.net/v1/chat/completions',
      {
        model: 'vendor/model-0731',
        messages: [
          { role: 'system', content: ASSISTANT_CONTEXT },
          { role: 'user', content: '¿Cómo agrego una zona?' },
          { role: 'assistant', content: 'Desde la cámara.' },
          { role: 'user', content: '¿Y si no la veo?' },
        ],
      },
      {
        headers: {
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );
  });

  it('refuses and contacts nothing when the assistant is disabled', async () => {
    config[EnvNames.ASSISTANT_ENABLED] = false;

    const result = await service.chat(conversation);

    expect(result).toMatchObject({ ok: false, code: ErrorCode.CONFLICT });
    expect(httpService.post).not.toHaveBeenCalled();
  });

  // A blank reply on the screen reads as "the assistant had nothing to say",
  // which is a different problem from the one that actually happened.
  it.each([
    ['no choices', of({ data: {} })],
    ['a non-string content', completion(42)],
    ['an empty content', completion('   ')],
  ])('refuses a body carrying %s', async (_label, answer) => {
    httpService.post.mockReturnValue(answer);

    const result = await service.chat(conversation);

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_ERROR,
    });
  });

  it('maps a gateway timeout to UPSTREAM_TIMEOUT', async () => {
    const timeout = new AxiosError('timeout of 30000ms exceeded');
    timeout.code = 'ECONNABORTED';
    httpService.post.mockReturnValue(throwError(() => timeout));

    const result = await service.chat(conversation);

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_TIMEOUT,
    });
  });

  it('maps a refusing gateway to UPSTREAM_ERROR', async () => {
    const refused = new AxiosError('Request failed with status code 401');
    refused.response = { status: 401 } as never;
    httpService.post.mockReturnValue(throwError(() => refused));

    const result = await service.chat(conversation);

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
  });

  // The token is the one value here that must never reach a log or a response.
  it('never puts the gateway token in the answer', async () => {
    const refused = new AxiosError('Request failed with status code 401');
    refused.response = { status: 401 } as never;
    httpService.post.mockReturnValue(throwError(() => refused));

    const result = await service.chat(conversation);

    expect(JSON.stringify(result)).not.toContain('sk-test');
  });
});
