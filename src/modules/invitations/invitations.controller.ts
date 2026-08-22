import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
// `import type` is required: these appear in decorated parameter positions and
// TS1272 rejects value imports there under isolatedModules.
import type { Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import type { SessionContext } from '../../cross/common/session-context.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Public } from '../../cross/decorators/public.decorator';
import { RequestSessionContext } from '../../cross/decorators/session-context.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { AccessTokenDto } from '../auth/dto/access-token.dto';
import { CredentialTokenDto } from '../auth/dto/credential-token.dto';
import { RefreshCookieService } from '../auth/refresh-cookie.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationListDto } from './dto/invitation-list.dto';
import { InvitationDto } from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  /** Adding somebody to a space is an administrator's decision, not a member's. */
  @Roles(SpaceMemberRole.admin)
  @HttpCode(HttpStatus.CREATED)
  @Post()
  @ApiOperation({
    summary: 'Invite somebody to the space',
    description:
      'Admin only. Creates a pending invitation for an email address and hands the ' +
      'invitee a single-use token, delivered out of band. The token is the whole ' +
      'credential — the invitee needs no account first.',
  })
  @ApiCreatedResponse({
    type: InvitationDto,
    description: 'Invitation created and pending.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Malformed body, or an email that is not an address.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
    [ErrorCode.CONFLICT]:
      'That email already belongs to the space, or already has a pending invitation.',
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateInvitationDto,
  ): Promise<Either<InvitationDto>> {
    return this.invitationsService.create(user.spaceId, user.sub, dto.email);
  }

  /** Who was invited to the space is an administrator's business. */
  @Roles(SpaceMemberRole.admin)
  @Get()
  @ApiOperation({
    summary: 'List the pending invitations of the space',
    description:
      'Admin only. Invitations that are neither accepted nor expired, newest first, ' +
      'never carrying the token.',
  })
  @ApiOkResponse({ type: InvitationListDto })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
  })
  findPending(
    @CurrentUser() user: JwtPayload,
  ): Promise<Either<InvitationListDto>> {
    return this.invitationsService.findPending(user.spaceId);
  }

  /** Public: the invitee has no session yet — the token is the credential. */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('accept')
  @ApiOperation({
    summary: 'Accept an invitation',
    description:
      'Public — the invitee has no session yet, so the invitation token is the ' +
      'credential. Consumes the token, joins the space and opens a session: the access ' +
      'token comes back in the body, the refresh token only as an `httpOnly` ' +
      'path-scoped cookie. A token is single-use; replaying it answers 401.',
  })
  @ApiOkResponse({
    type: AccessTokenDto,
    description:
      'Invitation consumed. Refresh token set as a cookie, never in the body.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body.',
    [ErrorCode.UNAUTHORIZED]:
      'Unknown, expired or already-used invitation token.',
    [ErrorCode.CONFLICT]:
      'The invited account is already a member of the space.',
  })
  async accept(
    @Body() dto: CredentialTokenDto,
    @RequestSessionContext() context: SessionContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    return this.refreshCookie.issueSession(
      res,
      await this.invitationsService.accept(dto.token, context),
    );
  }
}
