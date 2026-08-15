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
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
// `import type` is required: these appear in decorated parameter positions and
// TS1272 rejects value imports there under isolatedModules.
import type { Request, Response } from 'express';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Public } from '../../cross/decorators/public.decorator';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { AuthService } from './auth.service';
import { AccessTokenDto } from './dto/access-token.dto';
import { LoginDto } from './dto/login.dto';
import { MeDto } from './dto/me.dto';
import {
  buildRefreshCookieOptions,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
} from './refresh-cookie';

const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid or expired refresh token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOkResponse({ type: AccessTokenDto })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    const result = await this.authService.login(dto.email, dto.password);
    if (!result.ok) {
      return result;
    }

    this.setRefreshCookie(res, result.data.refreshToken);
    return buildData({ accessToken: result.data.accessToken });
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
    @Res({ passthrough: true }) res: Response,
  ): Promise<Either<AccessTokenDto>> {
    const cookies = req.cookies as Record<string, string | undefined>;
    const refreshToken = cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const result = await this.authService.refresh(refreshToken);
    if (!result.ok) {
      return result;
    }

    this.setRefreshCookie(res, result.data.refreshToken);
    return buildData({ accessToken: result.data.accessToken });
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  @Get('me')
  @ApiOkResponse({ type: MeDto })
  me(@CurrentUser() user: JwtPayload): Promise<Either<MeDto>> {
    return this.authService.me(user.email);
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    const isProduction =
      this.configService.get<string>(EnvNames.NODE_ENV) === 'production';

    res.cookie(
      REFRESH_COOKIE_NAME,
      refreshToken,
      buildRefreshCookieOptions(
        isProduction,
        this.authService.refreshCookieMaxAgeMs(refreshToken),
      ),
    );
  }
}
