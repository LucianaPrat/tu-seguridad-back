import { AxiosError } from 'axios';
import FormData from 'form-data';
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

/**
 * Every variable the service reads, chat and voice alike, so a suite can copy it
 * and flip the one switch it is about.
 */
const voiceConfig: Record<string, unknown> = {
  [EnvNames.ASSISTANT_ENABLED]: true,
  [EnvNames.ASSISTANT_API_URL]: 'https://llm.disier.net',
  [EnvNames.ASSISTANT_API_TOKEN]: 'sk-test',
  [EnvNames.ASSISTANT_MODEL]: 'vendor/model-0731',
  [EnvNames.ASSISTANT_TIMEOUT_MS]: 30000,
  [EnvNames.ASSISTANT_VOICE_ENABLED]: true,
  [EnvNames.ASSISTANT_STT_API_URL]: 'http://speech.local',
  [EnvNames.ASSISTANT_TTS_API_URL]: 'http://voice.local',
  [EnvNames.ASSISTANT_STT_MODEL]: 'large-v3-turbo',
  [EnvNames.ASSISTANT_STT_LANGUAGE]: 'es',
  [EnvNames.ASSISTANT_TTS_MODEL]: 'kokoro',
  [EnvNames.ASSISTANT_TTS_VOICE]: 'ef_dora',
};

const clip = {
  buffer: Buffer.from('opus-bytes'),
  originalname: 'question.webm',
  mimetype: 'audio/webm',
} as Express.Multer.File;

/**
 * `form-data` buffers everything in memory and nothing here is streamed, so the
 * fields a call actually sent can be read back off the body the mock received.
 * The alternative — a `toHaveBeenCalledWith` on the form itself, the way the
 * chat assertion works — cannot: a FormData instance is not deep-equal-able.
 */
const sentForm = (post: jest.Mock): string => {
  const [, form] = post.mock.calls[0] as [string, FormData];
  return form.getBuffer().toString();
};

describe('AssistantService', () => {
  let httpService: { post: jest.Mock };
  let config: Record<string, unknown>;
  let service: AssistantService;

  beforeEach(() => {
    httpService = { post: jest.fn().mockReturnValue(completion('Así.')) };
    config = { ...voiceConfig };
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

describe('AssistantService.transcribe', () => {
  let httpService: { post: jest.Mock };
  let config: Record<string, unknown>;
  let service: AssistantService;

  beforeEach(() => {
    httpService = {
      post: jest
        .fn()
        .mockReturnValue(of({ data: { text: '¿Cómo agrego una zona?' } })),
    };
    config = { ...voiceConfig };
    service = new AssistantService(
      httpService as never,
      {
        get: (name: string) => config[name],
      } as never,
    );
  });

  it('answers the transcript', async () => {
    const result = await service.transcribe(clip);

    expect(result).toEqual({
      ok: true,
      data: { text: '¿Cómo agrego una zona?' },
    });
  });

  // The form is the whole request here, so what it carries is the contract:
  // the configured model and language, and the domain hint that stops Whisper
  // writing "de vr" for "DVR".
  it('posts the clip to the STT gateway with the domain hint', async () => {
    await service.transcribe(clip);

    const [url, , options] = httpService.post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string>; timeout: number },
    ];
    expect(url).toBe('http://speech.local/v1/audio/transcriptions');
    expect(options.headers['content-type']).toContain('multipart/form-data');
    expect(options.headers.Authorization).toBe('Bearer sk-test');
    expect(options.timeout).toBe(30000);

    const body = sentForm(httpService.post);
    expect(body).toContain('large-v3-turbo');
    expect(body).toContain('name="language"');
    expect(body).toContain('DVR, canal');
    expect(body).toContain('name="temperature"');
  });

  it('refuses and contacts nothing when the assistant is disabled', async () => {
    config[EnvNames.ASSISTANT_ENABLED] = false;

    const result = await service.transcribe(clip);

    expect(result).toMatchObject({ ok: false, code: ErrorCode.CONFLICT });
    expect(httpService.post).not.toHaveBeenCalled();
  });

  // The case chat() never had: the gateway works, the audio half of it does not.
  it('refuses and contacts nothing when only the voice half is disabled', async () => {
    config[EnvNames.ASSISTANT_VOICE_ENABLED] = false;

    const result = await service.transcribe(clip);

    expect(result).toMatchObject({ ok: false, code: ErrorCode.CONFLICT });
    expect(httpService.post).not.toHaveBeenCalled();
  });

  // An empty transcript on the screen reads as "the operator said nothing",
  // which is a different problem from the one that actually happened.
  it.each([
    ['no text field', of({ data: {} })],
    ['a non-string text', of({ data: { text: 42 } })],
    ['an empty text', of({ data: { text: '   ' } })],
  ])('refuses a body carrying %s', async (_label, answer) => {
    httpService.post.mockReturnValue(answer);

    const result = await service.transcribe(clip);

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
  });

  it('maps a gateway timeout to UPSTREAM_TIMEOUT', async () => {
    const timeout = new AxiosError('timeout of 30000ms exceeded');
    timeout.code = 'ECONNABORTED';
    httpService.post.mockReturnValue(throwError(() => timeout));

    const result = await service.transcribe(clip);

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_TIMEOUT,
    });
  });

  it('maps a refusing gateway to UPSTREAM_ERROR', async () => {
    const refused = new AxiosError('Request failed with status code 500');
    refused.response = { status: 500 } as never;
    httpService.post.mockReturnValue(throwError(() => refused));

    const result = await service.transcribe(clip);

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
  });
});

describe('AssistantService.speak', () => {
  const mp3 = Buffer.from('ID3-bytes');
  let httpService: { post: jest.Mock };
  let config: Record<string, unknown>;
  let service: AssistantService;

  beforeEach(() => {
    httpService = { post: jest.fn().mockReturnValue(of({ data: mp3 })) };
    config = { ...voiceConfig };
    service = new AssistantService(
      httpService as never,
      {
        get: (name: string) => config[name],
      } as never,
    );
  });

  it('answers the audio bytes', async () => {
    const result = await service.speak('Desde la cámara.');

    expect(result).toEqual({ ok: true, data: mp3 });
  });

  // `responseType: 'arraybuffer'` is the load-bearing option: without it axios
  // parses the mp3 as text and hands back corrupted bytes.
  it('posts the text to the TTS gateway and asks for raw bytes', async () => {
    await service.speak('Desde la cámara.');

    expect(httpService.post).toHaveBeenCalledWith(
      'http://voice.local/v1/audio/speech',
      {
        model: 'kokoro',
        voice: 'ef_dora',
        input: 'Desde la cámara.',
        response_format: 'mp3',
        speed: 1,
      },
      {
        headers: {
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 30000,
      },
    );
  });

  it('refuses and contacts nothing when the assistant is disabled', async () => {
    config[EnvNames.ASSISTANT_ENABLED] = false;

    const result = await service.speak('hola');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.CONFLICT });
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('refuses and contacts nothing when only the voice half is disabled', async () => {
    config[EnvNames.ASSISTANT_VOICE_ENABLED] = false;

    const result = await service.speak('hola');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.CONFLICT });
    expect(httpService.post).not.toHaveBeenCalled();
  });

  // A zero-byte answer plays as silence, which looks like a mute speaker rather
  // than a failed synthesis — the known Kokoro Spanish failure mode exactly.
  it('refuses an answer carrying no audio', async () => {
    httpService.post.mockReturnValue(of({ data: Buffer.alloc(0) }));

    const result = await service.speak('hola');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
  });

  it('maps a gateway timeout to UPSTREAM_TIMEOUT', async () => {
    const timeout = new AxiosError('timeout of 30000ms exceeded');
    timeout.code = 'ECONNABORTED';
    httpService.post.mockReturnValue(throwError(() => timeout));

    const result = await service.speak('hola');

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.UPSTREAM_TIMEOUT,
    });
  });

  it('maps a refusing gateway to UPSTREAM_ERROR', async () => {
    const refused = new AxiosError('Request failed with status code 404');
    refused.response = { status: 404 } as never;
    httpService.post.mockReturnValue(throwError(() => refused));

    const result = await service.speak('hola');

    expect(result).toMatchObject({ ok: false, code: ErrorCode.UPSTREAM_ERROR });
  });

  it('never puts the gateway token in the answer', async () => {
    const refused = new AxiosError('Request failed with status code 401');
    refused.response = { status: 401 } as never;
    httpService.post.mockReturnValue(throwError(() => refused));

    const result = await service.speak('hola');

    expect(JSON.stringify(result)).not.toContain('sk-test');
  });
});
