import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
// `import type` is required: these appear in decorated parameter positions and
// TS1272 rejects value imports there under isolatedModules.
import type { Request, Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import type { SessionContext } from '../../cross/common/session-context.type';
import { AllowIncompleteProfile } from '../../cross/decorators/allow-incomplete-profile.decorator';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Public } from '../../cross/decorators/public.decorator';
import { RequestSessionContext } from '../../cross/decorators/session-context.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { buildError, Either } from '../../cross/errors/either';
import { AuthService } from './auth.service';
import { AccessTokenDto } from './dto/access-token.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { LoginDto } from './dto/login.dto';
import { MeDto } from './dto/me.dto';
import { RegisterDto } from './dto/register.dto';
import { REFRESH_COOKIE_NAME } from './refresh-cookie';
import { RefreshCookieService } from './refresh-cookie.service';
import {
  INVALID_REFRESH_TOKEN_MESSAGE,
  SessionService,
} from './session.service';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Public. Opens a session for an existing account. ' +
      'The access token comes back in the body; the refresh token is set only as an ' +
      '`httpOnly`, path-scoped cookie and is never returned in a body. A wrong password ' +
      'and an unknown address answer the same 401, so the route cannot be used to ' +
      'probe which addresses have accounts.',
  })
  @ApiOkResponse({
    type: AccessTokenDto,
    description: 'Session opened. Refresh cookie set on the response.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body.',
    [ErrorCode.UNAUTHORIZED]:
      'Wrong password, unknown address, or a disabled account.',
  })
  async login(
    @Body() dto: LoginDto,
    @RequestSessionContext() context: SessionContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    return this.refreshCookie.issueSession(
      res,
      await this.authService.login(dto.email, dto.password, context),
    );
  }

  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Post('register')
  @ApiOperation({
    summary: 'Register an account',
    description:
      'Public. Creates the account and opens a session in one call. ' +
      'The access token comes back in the body; the refresh token is set only as an ' +
      '`httpOnly`, path-scoped cookie. The account may still need ' +
      '`POST /auth/complete-profile` before the rest of the API opens up — read ' +
      '`GET /auth/me` to find out.',
  })
  @ApiCreatedResponse({
    type: AccessTokenDto,
    description: 'Account created and session opened.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Malformed body, or a password that fails the policy.',
    [ErrorCode.CONFLICT]: 'That email is already registered.',
  })
  async register(
    @Body() dto: RegisterDto,
    @RequestSessionContext() context: SessionContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    return this.refreshCookie.issueSession(
      res,
      await this.authService.register(dto, context),
    );
  }

  /**
   * Cookie-only on purpose. A body fallback would be a second accepted path to
   * the same credential, and those tend to survive into production.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({
    summary: 'Rotate the session',
    description:
      'Public, but the refresh cookie is the credential — this route reads no body and ' +
      'accepts no fallback. Rotates the pair: the old refresh token is revoked, a new ' +
      'one replaces the cookie and a fresh access token comes back in the body. ' +
      'Presenting an access token here fails, and re-using an already-rotated refresh ' +
      'token is treated as replay.',
  })
  @ApiOkResponse({
    type: AccessTokenDto,
    description: 'Pair rotated. New refresh cookie set on the response.',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]:
      'No refresh cookie, or a token that is expired, revoked, replayed or of the wrong type.',
  })
  async refresh(
    @Req() req: Request,
    @RequestSessionContext() context: SessionContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    const refreshToken = this.readRefreshCookie(req);
    if (!refreshToken) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE);
    }

    return this.refreshCookie.issueSession(
      res,
      await this.sessionService.rotate(refreshToken, context),
    );
  }

  /** Revokes the stored token as well as dropping the cookie. */
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  @ApiOperation({
    summary: 'Log out',
    description:
      'Public, and deliberately forgiving: clears the refresh cookie and revokes the ' +
      'stored token when one is present, but answers 204 either way so a client can ' +
      'always reach a logged-out state.',
  })
  @ApiNoContentResponse({
    description: 'Session closed and cookie cleared. Empty body.',
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const refreshToken = this.readRefreshCookie(req);
    if (refreshToken) {
      await this.sessionService.revoke(refreshToken);
    }
    this.refreshCookie.clear(res);
  }

  @AllowIncompleteProfile()
  @Get('me')
  @ApiOperation({
    summary: 'Read the current user',
    description:
      'The account behind the bearer token, with its space and role — the context every ' +
      'other route scopes to. Reachable with an incomplete profile, so a client can read ' +
      'it to decide whether to send the user to `POST /auth/complete-profile` first.',
  })
  @ApiOkResponse({
    type: MeDto,
    description: 'Current account, space and role.',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
  })
  me(@CurrentUser() user: JwtPayload): Promise<Either<MeDto>> {
    return this.authService.me(user.sub);
  }

  @AllowIncompleteProfile()
  @HttpCode(HttpStatus.OK)
  @Post('complete-profile')
  @ApiOperation({
    summary: 'Complete the profile',
    description:
      'Fills in what registration or an invitation left open. One of the few routes ' +
      'reachable with an incomplete profile — every other protected route answers 403 ' +
      'until this succeeds. Re-issues the session afterwards, because the token claims ' +
      'change: a new access token comes back in the body and the refresh cookie is replaced.',
  })
  @ApiOkResponse({
    type: AccessTokenDto,
    description: 'Profile completed and session re-issued.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.CONFLICT]: 'The profile is already completed.',
  })
  async completeProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CompleteProfileDto,
    @RequestSessionContext() context: SessionContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    return this.refreshCookie.issueSession(
      res,
      await this.authService.completeProfile(user.sub, dto, context),
    );
  }

  private readRefreshCookie(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, string | undefined>;
    return cookies?.[REFRESH_COOKIE_NAME];
  }
}
