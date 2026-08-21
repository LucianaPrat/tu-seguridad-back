import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ErrorCode } from '../../cross/common/constants';
import { Public } from '../../cross/decorators/public.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { validationExceptionFactory } from '../../cross/errors/validation-exception.factory';
import {
  StreamAuthorizationDto,
  StreamAuthorizationResultDto,
} from './dto/stream-authorization.dto';
import { LiveStreamService } from './live-stream.service';

/**
 * The hook's own body pipe, and the reason the handler declares the body as
 * `object` rather than as the DTO.
 *
 * Nest applies global pipes **before** scoped ones, so a route pipe cannot
 * loosen the global `forbidNonWhitelisted`: the global pipe only skips a body
 * whose declared type it has nothing to validate against. `object` is such a
 * type, and `expectedType` then points this pipe at the real shape.
 *
 * The point is `whitelist` without `forbidNonWhitelisted`. A field a future
 * MediaMTX release adds is stripped here instead of turning the hook into a 400
 * — and MediaMTX reads anything but 200 as "deny", so that 400 would lock out
 * every viewer of every camera at once. The declared fields stay the contract;
 * a declared field that is missing or not a string is still a 400.
 */
const HOOK_BODY_PIPE = new ValidationPipe({
  expectedType: StreamAuthorizationDto,
  whitelist: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

@ApiTags('streaming')
@Controller('streaming')
export class StreamingController {
  constructor(private readonly liveStreamService: LiveStreamService) {}

  /**
   * `@Public()` because the caller is the media server, which holds no session
   * of ours: the reader's token travels in the body, and this route validates it
   * by hand rather than through the bearer guard.
   *
   * That makes the route an authorization oracle, so it is worth being precise
   * about what it discloses: a 200 means "this token is valid and names a camera
   * in its own space", which is exactly what `GET /cameras/:id` already tells the
   * same caller. It grants nothing a token holder did not already have.
   */
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @Post('authorize')
  @ApiOperation({
    summary: 'Authorize one media-server request',
    description:
      'The hook MediaMTX calls for a playlist and for every segment. Public: the ' +
      'media server has no session, and it forwards the reader bearer token in the ' +
      'body instead of the header, so this route validates the token itself with ' +
      'the same verifier the bearer guard uses. Only `read` over `hls` is ever ' +
      'authorized, and only for a camera inside the space the token names. ' +
      'MediaMTX reads the status code: 200 admits the reader, anything else ' +
      'refuses it.',
  })
  @ApiOkResponse({
    type: StreamAuthorizationResultDto,
    description: 'Reader admitted.',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]:
      'No token, an expired or invalid one, a refresh token, or one carrying no space.',
    [ErrorCode.FORBIDDEN]:
      'A action other than `read`, a protocol other than `hls`, or an incomplete profile.',
    [ErrorCode.NOT_FOUND]: 'The path names no camera in the caller space.',
    [ErrorCode.CONFLICT]: 'The camera is disabled.',
    [ErrorCode.VALIDATION_ERROR]:
      'A declared field is missing or is not a string. A field the media ' +
      'server sends and this API does not declare is stripped, never refused.',
  })
  @ApiBody({ type: StreamAuthorizationDto })
  authorize(
    @Body(HOOK_BODY_PIPE) body: object,
  ): Promise<Either<StreamAuthorizationResultDto>> {
    return this.liveStreamService.authorize(body as StreamAuthorizationDto);
  }
}
