import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
// `import type` is required: these appear in decorated parameter positions and
// TS1272 rejects value imports there under isolatedModules.
import type { Response } from 'express';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import type { SessionContext } from '../../cross/common/session-context.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Public } from '../../cross/decorators/public.decorator';
import { RequestSessionContext } from '../../cross/decorators/session-context.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { Either } from '../../cross/errors/either';
import { AccessTokenDto } from '../auth/dto/access-token.dto';
import { CredentialTokenDto } from '../auth/dto/credential-token.dto';
import { RefreshCookieService } from '../auth/refresh-cookie.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationDto } from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@ApiBearerAuth()
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
  @ApiOkResponse({ type: InvitationDto })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateInvitationDto,
  ): Promise<Either<InvitationDto>> {
    return this.invitationsService.create(user.spaceId, user.sub, dto.email);
  }

  /** Public: the invitee has no session yet — the token is the credential. */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('accept')
  @ApiOkResponse({ type: AccessTokenDto })
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
