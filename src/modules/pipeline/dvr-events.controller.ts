import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorCode } from '../../cross/common/constants';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { DvrEventStatusDto } from './dto/dvr-event-status.dto';
import { DvrEventListener } from './dvr-event.listener';

/**
 * Under `/dvr` for the caller, but here and not in `DvrController`: the status
 * lives in the listener, and `DvrModule` cannot import `PipelineModule`
 * without a cycle.
 */
@ApiTags('dvr')
@Controller('dvr')
export class DvrEventsController {
  constructor(private readonly listener: DvrEventListener) {}

  @Get('events')
  @ApiOperation({
    summary: 'Recorder event connection status',
    description:
      'Whether this API currently has the space recorder event stream open, when it ' +
      'last heard from it, and when it last reported motion. Any member may read it.',
  })
  @ApiOkResponse({ type: DvrEventStatusDto })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'The space has no recorder configured yet.',
  })
  async status(
    @CurrentUser() user: JwtPayload,
  ): Promise<Either<DvrEventStatusDto>> {
    const status = await this.listener.statusFor(user.spaceId);
    if (!status) {
      return buildError(
        ErrorCode.NOT_FOUND,
        'This space has no DVR configured yet',
      );
    }
    return buildData({ enabled: this.listener.enabled, ...status });
  }
}
