import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  ParseFilePipeBuilder,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
// `import type` is required: this appears in a decorated parameter position and
// TS1272 rejects a value import there under isolatedModules.
import type { Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import { AssistantThrottle } from '../../cross/decorators/route-throttle.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { buildGuardException } from '../../cross/errors/guard-exception';
import { UploadTooLargeFilter } from '../../cross/errors/upload-too-large.filter';
import { AssistantService } from './assistant.service';
import { AssistantChatResponseDto } from './dto/assistant-chat-response.dto';
import { AssistantChatRequestDto } from './dto/assistant-chat.dto';
import { AssistantSpeakDto } from './dto/assistant-speak.dto';
import { AssistantTranscribeResponseDto } from './dto/assistant-transcribe-response.dto';

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

  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  @AssistantThrottle()
  @UseInterceptors(FileInterceptor('file'))
  @UseFilters(UploadTooLargeFilter)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Turn a spoken clip into text',
    description:
      'Transcribes one uploaded audio clip and answers the text, so a caller can feed it straight to `POST /assistant/chat`. Whatever the browser recorder produced is accepted as-is — no transcoding, no container conversion. The language is fixed by deployment config, not detected and not a body field: a short clip is too little audio to identify one reliably. Nothing is stored. `CONFLICT` when the assistant or its voice half is not enabled on the deployment.',
  })
  @ApiOkResponse({ type: AssistantTranscribeResponseDto })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'No `file` field, a file that is not audio, or one over the size limit.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.CONFLICT]:
      'The assistant, or its voice half, is not enabled on this deployment.',
    [ErrorCode.UPSTREAM_ERROR]:
      'The speech gateway refused the call or answered a body that carries no transcript.',
    [ErrorCode.UPSTREAM_TIMEOUT]: 'The speech gateway did not answer in time.',
  })
  transcribe(
    @UploadedFile(
      new ParseFilePipeBuilder()
        // `/^audio\//` alone is too strict: `file-type`'s magic-number sniff
        // reports a WebM container as `video/webm` whether or not the only
        // track inside is audio, so the browser recorder's own output would
        // fail its own upload. Same `fallbackToMimetype` safety net the camera
        // upload uses, for the same reason — the ESM entry point of
        // `file-type` is not always loadable.
        .addFileTypeValidator({
          fileType: /^(audio|video)\//,
          fallbackToMimetype: true,
        })
        // `ParseFilePipe`'s own refusal is a bare Nest 400, shaped unlike every
        // other error this API answers. Routing it through the shared builder
        // puts it back in the envelope under `VALIDATION_ERROR`, which is what
        // the table above promises and what a client already parses.
        .build({
          exceptionFactory: (error: string) =>
            buildGuardException(ErrorCode.VALIDATION_ERROR, error),
        }),
    )
    file: Express.Multer.File,
  ): Promise<Either<AssistantTranscribeResponseDto>> {
    return this.assistantService.transcribe(file);
  }

  /**
   * Uses `@Res` because the body is mp3 bytes, not an `Either` for the
   * interceptor to unwrap — the same shape `SnapshotsController.read` uses, and
   * the same reason failures still throw the shared error body.
   *
   * No `ETag`, unlike that route: a stored frame has an identity worth
   * revalidating against, a synthesized reply does not — nothing asks for the
   * same bytes twice.
   */
  @Post('speak')
  @HttpCode(HttpStatus.OK)
  @AssistantThrottle()
  @ApiOperation({
    summary: 'Read a text aloud',
    description:
      'Answers mp3 bytes for the text it was given, so a client can play an assistant reply instead of reading it. The voice and the model are deployment config, never body fields — swapping either is a redeploy decision, not a per-request one. Nothing is stored and nothing is cached: the same text asked twice is synthesized twice. `CONFLICT` when the assistant or its voice half is not enabled on the deployment.',
  })
  @ApiOkResponse({
    description: 'MP3 bytes.',
    content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Empty `text`, or one over 4096 characters.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.CONFLICT]:
      'The assistant, or its voice half, is not enabled on this deployment.',
    [ErrorCode.UPSTREAM_ERROR]:
      'The speech gateway refused the call or answered no audio.',
    [ErrorCode.UPSTREAM_TIMEOUT]: 'The speech gateway did not answer in time.',
  })
  async speak(
    @Body() dto: AssistantSpeakDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.assistantService.speak(dto.text);
    if (!result.ok) {
      throw buildGuardException(
        result.code,
        result.message ?? 'assistant speak failed',
      );
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', result.data.byteLength);
    res.end(result.data);
  }
}
