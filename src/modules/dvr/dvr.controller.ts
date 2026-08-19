import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { ConfigureDvrDto } from './dto/configure-dvr.dto';
import { DvrDto } from './dto/dvr.dto';
import { DvrService } from './dvr.service';

@ApiTags('dvr')
@ApiBearerAuth()
@Controller('dvr')
export class DvrController {
  constructor(private readonly dvrService: DvrService) {}

  /** Any member may see which recorder the space watches; only an admin may change it. */
  @Get()
  @ApiOperation({
    summary: 'Read the space recorder',
    description:
      'The DVR the caller space watches, without its password — the stored credential ' +
      'is never returned by any route. Answers 404 while no recorder has been ' +
      'configured yet, which is the normal state of a new space.',
  })
  @ApiOkResponse({
    type: DvrDto,
    description: 'Recorder configuration, password omitted.',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'The space has no recorder configured yet.',
  })
  findOne(@CurrentUser() user: JwtPayload): Promise<Either<DvrDto>> {
    return this.dvrService.findBySpace(user.spaceId);
  }

  @Roles(SpaceMemberRole.admin)
  @Put()
  @ApiOperation({
    summary: 'Initialize or re-point the recorder',
    description:
      'Admin only. Stores the recorder the space watches and immediately discovers its ' +
      'channels. Connectivity is tested first and a configuration that cannot be ' +
      'reached is not stored, so a 502 or 504 leaves the previous recorder in place. ' +
      'Discovered channels are reconciled by external id: a channel that comes back ' +
      'keeps its monitor configuration, one that stopped answering becomes ' +
      '`isConfigured: false` rather than being deleted.',
  })
  @ApiOkResponse({
    type: DvrDto,
    description: 'Recorder stored and reconciled. Password omitted.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Malformed body, or a recorder URL that is not usable.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
    [ErrorCode.UPSTREAM_ERROR]:
      'The recorder refused the credentials or answered an error. Nothing was stored.',
    [ErrorCode.UPSTREAM_TIMEOUT]:
      'The recorder did not answer in time. Nothing was stored.',
  })
  configure(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfigureDvrDto,
  ): Promise<Either<DvrDto>> {
    return this.dvrService.configure(user.spaceId, dto);
  }

  @Roles(SpaceMemberRole.admin)
  @HttpCode(HttpStatus.OK)
  @Post('discovery')
  @ApiOperation({
    summary: 'Re-run channel discovery',
    description:
      'Admin only. Re-runs discovery against the already-stored credentials, so it ' +
      'takes no body. Use it after adding or moving channels on the recorder. Same ' +
      'reconciliation as `PUT /dvr`: matching channels keep their configuration, ' +
      'channels that stopped answering become `isConfigured: false`.',
  })
  @ApiOkResponse({
    type: DvrDto,
    description: 'Discovery finished and cameras reconciled.',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
    [ErrorCode.NOT_FOUND]: 'The space has no recorder configured yet.',
    [ErrorCode.UPSTREAM_ERROR]:
      'The recorder refused the stored credentials or answered an error.',
    [ErrorCode.UPSTREAM_TIMEOUT]: 'The recorder did not answer in time.',
  })
  rediscover(@CurrentUser() user: JwtPayload): Promise<Either<DvrDto>> {
    return this.dvrService.rediscover(user.spaceId);
  }
}
