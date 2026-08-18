import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { EnvNames } from '../../cross/common/constants';
import { buildData, Either } from '../../cross/errors/either';
import { AccessTokenDto } from './dto/access-token.dto';
import { TokenPairDto } from './dto/token-pair.dto';
import {
  buildRefreshCookieOptions,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
} from './refresh-cookie';
import { SessionService } from './session.service';

/**
 * Seven routes now hand back a session: login, register, refresh, profile
 * completion, magic link, face login and invitation acceptance. They all set the
 * same cookie the same way and all keep the refresh token out of the body, so
 * both rules live here instead of in four controllers.
 */
@Injectable()
export class RefreshCookieService {
  constructor(
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
  ) {}

  attach(res: Response, refreshToken: string): void {
    const isProduction =
      this.configService.get<string>(EnvNames.NODE_ENV) === 'production';
    res.cookie(
      REFRESH_COOKIE_NAME,
      refreshToken,
      buildRefreshCookieOptions(
        isProduction,
        this.sessionService.refreshCookieMaxAgeMs(refreshToken),
      ),
    );
  }

  /**
   * The refresh token leaves through the cookie and nowhere else, so the body
   * keeps only the access token. A failed result sets no cookie at all.
   */
  issueSession(
    res: Response,
    result: Either<TokenPairDto>,
  ): Either<AccessTokenDto> {
    if (!result.ok) {
      return result;
    }
    this.attach(res, result.data.refreshToken);
    return buildData({ accessToken: result.data.accessToken });
  }

  clear(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }
}
