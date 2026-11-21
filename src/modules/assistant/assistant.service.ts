import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import FormData from 'form-data';
import { firstValueFrom } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { mapUpstreamError } from '../../cross/errors/upstream-error';
import { ASSISTANT_CONTEXT } from './assistant-context';
import { AssistantChatResponseDto } from './dto/assistant-chat-response.dto';
import { AssistantChatRequestDto } from './dto/assistant-chat.dto';
import { AssistantTranscribeResponseDto } from './dto/assistant-transcribe-response.dto';

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
 * Sent on every transcription. This is how Whisper stops writing "de vr" for
 * "DVR" and "sona" for "zona" — the terms an operator says most, biased in
 * advance. Not configurable: one string, one deployment, no knob to get wrong.
 */
const TRANSCRIBE_PROMPT = 'cámara, zona, intruso, sospechoso, DVR, canal';

/**
 * The one usable transcription shape: a body carrying non-empty `text`.
 *
 * Same reasoning as `replyOf` — an unreadable body would otherwise reach the
 * screen as an empty transcript, which looks like the operator said nothing
 * rather than like the gateway failed.
 */
const textOf = (body: unknown): string => {
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== 'string' || text.trim() === '') {
    return '';
  }
  return text;
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
 *
 * `transcribe` and `speak` are the same idea in audio, and stateless in the
 * same way: no id ties a transcript to the reply that gets read back, the
 * client is what threads them. They sit behind a second switch because the
 * gateway that serves chat today serves no audio routes, so their URLs default
 * to it and override to whatever container actually does.
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

  /**
   * Turns an uploaded clip into text. The file is forwarded byte-for-byte —
   * whatever the browser recorder produced, `audio/webm;codecs=opus` on Chrome
   * and Firefox or `audio/mp4` on Safari — because a Whisper backend reads
   * either and transcoding here would only add a dependency and a failure mode.
   */
  async transcribe(
    file: Express.Multer.File,
  ): Promise<Either<AssistantTranscribeResponseDto>> {
    if (!this.voiceEnabled()) {
      return buildError(
        ErrorCode.CONFLICT,
        'the assistant voice routes are not enabled on this deployment',
      );
    }

    const form = new FormData();
    form.append('file', file.buffer, file.originalname);
    form.append('model', this.sttModel());
    form.append('language', this.sttLanguage());
    form.append('prompt', TRANSCRIBE_PROMPT);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(
          `${this.sttApiUrl()}/v1/audio/transcriptions`,
          form,
          {
            // `form.getHeaders()` carries the generated multipart boundary; a
            // hand-written Content-Type here would not match the body.
            headers: {
              ...form.getHeaders(),
              Authorization: `Bearer ${this.token()}`,
            },
            timeout: this.timeout(),
          },
        ),
      );

      const text = textOf(response.data);
      if (text === '') {
        this.logger.warn('assistant STT answered a body it cannot read');
        return buildError(
          ErrorCode.UPSTREAM_ERROR,
          'assistant transcribe answered no usable text',
        );
      }

      return buildData({ text });
    } catch (error) {
      return mapUpstreamError(error, 'assistant transcribe');
    }
  }

  /** Reads a text back as mp3 bytes. Nothing is stored; the buffer is the answer. */
  async speak(text: string): Promise<Either<Buffer>> {
    if (!this.voiceEnabled()) {
      return buildError(
        ErrorCode.CONFLICT,
        'the assistant voice routes are not enabled on this deployment',
      );
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<ArrayBuffer>(
          `${this.ttsApiUrl()}/v1/audio/speech`,
          {
            model: this.ttsModel(),
            voice: this.ttsVoice(),
            input: text,
            response_format: 'mp3',
            speed: 1,
          },
          {
            headers: {
              Authorization: `Bearer ${this.token()}`,
              'Content-Type': 'application/json',
            },
            // Without this axios parses the mp3 as text and corrupts it.
            responseType: 'arraybuffer',
            timeout: this.timeout(),
          },
        ),
      );

      const audio = Buffer.from(response.data);
      if (audio.byteLength === 0) {
        this.logger.warn('assistant TTS answered no audio');
        return buildError(
          ErrorCode.UPSTREAM_ERROR,
          'assistant speak answered no audio',
        );
      }

      return buildData(audio);
    } catch (error) {
      return mapUpstreamError(error, 'assistant speak');
    }
  }

  /**
   * Both switches, checked together. `ASSISTANT_ENABLED=false` has to answer
   * CONFLICT on these routes exactly as it does on `chat()`, and
   * `ASSISTANT_VOICE_ENABLED=false` has to answer the same code without
   * touching chat.
   */
  private voiceEnabled(): boolean {
    return (
      !!this.configService.get<boolean>(EnvNames.ASSISTANT_ENABLED) &&
      !!this.configService.get<boolean>(EnvNames.ASSISTANT_VOICE_ENABLED)
    );
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

  private sttApiUrl(): string | undefined {
    return this.configService.get<string>(EnvNames.ASSISTANT_STT_API_URL);
  }

  private ttsApiUrl(): string | undefined {
    return this.configService.get<string>(EnvNames.ASSISTANT_TTS_API_URL);
  }

  private sttModel(): string {
    return this.configService.get<string>(EnvNames.ASSISTANT_STT_MODEL) ?? '';
  }

  private sttLanguage(): string {
    return (
      this.configService.get<string>(EnvNames.ASSISTANT_STT_LANGUAGE) ?? ''
    );
  }

  private ttsModel(): string {
    return this.configService.get<string>(EnvNames.ASSISTANT_TTS_MODEL) ?? '';
  }

  private ttsVoice(): string {
    return this.configService.get<string>(EnvNames.ASSISTANT_TTS_VOICE) ?? '';
  }
}
