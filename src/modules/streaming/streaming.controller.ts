import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorCode } from '../../cross/common/constants';
import { Public } from '../../cross/decorators/public.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import {
  StreamAuthorizationDto,
  StreamAuthorizationResultDto,
} from './dto/stream-authorization.dto';
import { LiveStreamService } from './live-stream.service';

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
      'The media server sent a field this API does not declare.',
  })
  authorize(
    @Body() dto: StreamAuthorizationDto,
  ): Promise<Either<StreamAuthorizationResultDto>> {
    return this.liveStreamService.authorize(dto);
  }
}
