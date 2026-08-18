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
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
  @ApiOkResponse({ type: AccessTokenDto })
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
  @ApiOkResponse({ type: AccessTokenDto })
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
  @ApiOkResponse({ type: AccessTokenDto })
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
  @ApiOkResponse({ type: MeDto })
  me(@CurrentUser() user: JwtPayload): Promise<Either<MeDto>> {
    return this.authService.me(user.sub);
  }

  @AllowIncompleteProfile()
  @HttpCode(HttpStatus.OK)
  @Post('complete-profile')
  @ApiOkResponse({ type: AccessTokenDto })
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
