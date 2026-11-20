import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
// `import type` is required: these appear in decorated parameter positions and
// TS1272 rejects value imports there under isolatedModules.
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
import { Public } from '../../cross/decorators/public.decorator';
import { CredentialThrottle } from '../../cross/decorators/route-throttle.decorator';
import { RequestSessionContext } from '../../cross/decorators/session-context.decorator';
import { RequireMenu } from '../../cross/decorators/require-menu.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { AccessTokenDto } from '../auth/dto/access-token.dto';
import { RefreshCookieService } from '../auth/refresh-cookie.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationListDto } from './dto/invitation-list.dto';
import {
  InvitationPreviewDto,
  InvitationPreviewQueryDto,
  MyInvitationDto,
} from './dto/invitation-preview.dto';
import { InvitationDto } from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

const ADMIN_FAILURES = {
  [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
  [ErrorCode.FORBIDDEN]:
    'Caller is not a space admin, or has an incomplete profile.',
};

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
      'Admin only. Creates a pending invitation with the role, menu access and cameras ' +
      'the invitee will get, and mails a single-use link. The invitee may already have ' +
      'an account, in this or other spaces.',
  })
  @ApiCreatedResponse({
    type: InvitationDto,
    description: 'Invitation created and pending.',
  })
  @ApiFailures({
    ...ADMIN_FAILURES,
    [ErrorCode.VALIDATION_ERROR]:
      'Malformed body, or cameraIds that are not cameras of this space.',
    [ErrorCode.CONFLICT]:
      'That email is already a member of the space, or already has a pending invitation here.',
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateInvitationDto,
  ): Promise<Either<InvitationDto>> {
    return this.invitationsService.create(user.spaceId, user.sub, dto);
  }

  /** Pending invitations belong to the Members section. */
  @RequireMenu('members')
  @Get()
  @ApiOperation({
    summary: 'List the pending invitations of the space',
    description:
      'Members section. Pending means not accepted, declined, revoked or expired. Newest ' +
      'first, never carrying the token.',
  })
  @ApiOkResponse({ type: InvitationListDto })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller lacks the members section, or has an incomplete profile.',
  })
  findPending(
    @CurrentUser() user: JwtPayload,
  ): Promise<Either<InvitationListDto>> {
    return this.invitationsService.findPending(user.spaceId);
  }

  /** Public: the invitee may have no account yet — the token is the credential. */
  @Public()
  @CredentialThrottle()
  @Get('preview')
  @ApiOperation({
    summary: 'Preview an invitation from its link',
    description:
      'Public. Tells the invitee who invited them, to what and whether the address ' +
      'already has an account, so the client can choose sign-in or registration.',
  })
  @ApiOkResponse({ type: InvitationPreviewDto })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Missing token.',
    [ErrorCode.NOT_FOUND]: 'Unknown, expired or no longer pending invitation.',
  })
  preview(
    @Query() query: InvitationPreviewQueryDto,
  ): Promise<Either<InvitationPreviewDto>> {
    return this.invitationsService.preview(query.token);
  }

  @AllowNoSpace()
  @Get('mine')
  @ApiOperation({
    summary: 'List the pending invitations addressed to the caller',
  })
  @ApiOkResponse({ type: MyInvitationDto, isArray: true })
  @ApiFailures({ [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.' })
  mine(
    @CurrentClaims() claims: AccessTokenClaims,
  ): Promise<Either<MyInvitationDto[]>> {
    return this.invitationsService.findMine(claims.email);
  }

  @Roles(SpaceMemberRole.admin)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke a pending invitation',
    description: 'Admin only. The link stops working immediately.',
  })
  @ApiParam({ name: 'id', description: 'Invitation id, in the caller space.' })
  @ApiNoContentResponse({ description: 'Invitation revoked. Empty body.' })
  @ApiFailures({
    ...ADMIN_FAILURES,
    [ErrorCode.NOT_FOUND]: 'No pending invitation with that id in this space.',
  })
  revoke(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<null>> {
    return this.invitationsService.revoke(user.spaceId, id);
  }

  @Roles(SpaceMemberRole.admin)
  @HttpCode(HttpStatus.OK)
  @Post(':id/resend')
  @ApiOperation({
    summary: 'Resend a pending invitation',
    description:
      'Admin only. Issues a new link and expiry and mails it; the previous link stops working.',
  })
  @ApiParam({ name: 'id', description: 'Invitation id, in the caller space.' })
  @ApiOkResponse({ type: InvitationDto })
  @ApiFailures({
    ...ADMIN_FAILURES,
    [ErrorCode.NOT_FOUND]: 'No pending invitation with that id in this space.',
  })
  resend(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<InvitationDto>> {
    return this.invitationsService.resend(user.spaceId, id);
  }

  @AllowNoSpace()
  @HttpCode(HttpStatus.OK)
  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept an invitation',
    description:
      'The caller must be signed in as the invited address. Creates the membership ' +
      'and moves the session into that space: a new access token in the body, the ' +
      'refresh cookie replaced.',
  })
  @ApiParam({ name: 'id', description: 'Invitation id.' })
  @ApiOkResponse({
    type: AccessTokenDto,
    description: 'Joined and session moved.',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'The invitation was sent to a different address, or the profile is incomplete.',
    [ErrorCode.CONFLICT]:
      'The invitation is no longer pending (accepted, declined, revoked or expired).',
  })
  async accept(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('id') id: string,
    @RequestSessionContext() context: SessionContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    return this.refreshCookie.replaceSession(
      req,
      res,
      await this.invitationsService.accept(claims, id, context),
    );
  }

  @AllowNoSpace()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/decline')
  @ApiOperation({ summary: 'Decline an invitation' })
  @ApiParam({ name: 'id', description: 'Invitation id.' })
  @ApiNoContentResponse({ description: 'Invitation declined. Empty body.' })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'The invitation was sent to a different address, or the profile is incomplete.',
    [ErrorCode.CONFLICT]: 'The invitation is no longer pending.',
  })
  decline(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('id') id: string,
  ): Promise<Either<null>> {
    return this.invitationsService.decline(claims, id);
  }
}
