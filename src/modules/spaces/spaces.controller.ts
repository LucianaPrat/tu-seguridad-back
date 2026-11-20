import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import type {
  AccessTokenClaims,
  JwtPayload,
} from '../../cross/common/jwt-payload.type';
import type { SessionContext } from '../../cross/common/session-context.type';
import { AllowNoSpace } from '../../cross/decorators/allow-no-space.decorator';
import { CurrentClaims } from '../../cross/decorators/current-claims.decorator';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { RequestSessionContext } from '../../cross/decorators/session-context.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { AccessTokenDto } from '../auth/dto/access-token.dto';
import { RefreshCookieService } from '../auth/refresh-cookie.service';
import { SpaceNameDto } from './dto/space-name.dto';
import { SpaceSummaryDto } from './dto/space-summary.dto';
import { SpacesService } from './spaces.service';

@ApiTags('spaces')
@Controller('spaces')
export class SpacesController {
  constructor(
    private readonly spacesService: SpacesService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  @AllowNoSpace()
  @Get()
  @ApiOperation({
    summary: 'List the spaces the caller belongs to',
    description: 'Ordered by name, each with the caller role in it.',
  })
  @ApiOkResponse({ type: SpaceSummaryDto, isArray: true })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
  })
  list(
    @CurrentClaims() claims: AccessTokenClaims,
  ): Promise<Either<SpaceSummaryDto[]>> {
    return this.spacesService.list(claims);
  }

  @AllowNoSpace()
  @Post()
  @ApiOperation({
    summary: 'Create a space',
    description:
      'The caller becomes its admin and the session moves into it: the new access token ' +
      'comes back in the body and the refresh cookie is replaced.',
  })
  @ApiCreatedResponse({ type: AccessTokenDto })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
  })
  async create(
    @CurrentClaims() claims: AccessTokenClaims,
    @Body() dto: SpaceNameDto,
    @RequestSessionContext() context: SessionContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    return this.refreshCookie.replaceSession(
      req,
      res,
      await this.spacesService.create(claims, dto.name, context),
    );
  }

  @Roles(SpaceMemberRole.admin)
  @Patch('current')
  @ApiOperation({
    summary: 'Rename the current space',
    description: 'Admin only.',
  })
  @ApiOkResponse({ type: SpaceSummaryDto })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller is not an admin of the current space.',
  })
  rename(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SpaceNameDto,
  ): Promise<Either<SpaceSummaryDto>> {
    return this.spacesService.rename(user.spaceId, user.role, dto.name);
  }

  @Roles(SpaceMemberRole.admin)
  @HttpCode(HttpStatus.OK)
  @Delete('current')
  @ApiOperation({
    summary: 'Delete the current space',
    description:
      'Admin only. Refused while the space still has a DVR. Removes its memberships, ' +
      'invitations and alert routings, then re-issues the session in another space of ' +
      'the caller, or in none.',
  })
  @ApiOkResponse({ type: AccessTokenDto })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller is not an admin of the current space.',
    [ErrorCode.CONFLICT]: 'The space still has a DVR.',
  })
  async remove(
    @CurrentUser() user: JwtPayload,
    @RequestSessionContext() context: SessionContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    return this.refreshCookie.replaceSession(
      req,
      res,
      await this.spacesService.remove(user.sub, user.spaceId, context),
    );
  }
}
