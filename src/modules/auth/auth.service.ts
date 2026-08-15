import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import {
  asExpiresIn,
  JwtPayload,
  RefreshJwtPayload,
} from '../../cross/common/jwt-payload.type';
import { UserAccessorService } from '../../data/accessors/user.accessor';
import { MeDto } from './dto/me.dto';
import { TokenPairDto } from './dto/token-pair.dto';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid or expired refresh token';

@Injectable()
export class AuthService {
  constructor(
    private readonly userAccessor: UserAccessorService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<Either<TokenPairDto>> {
    const user = await this.userAccessor.findByEmail(email);
    if (!user) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return buildData(this.issueTokenPair(payload));
  }

  async refresh(refreshToken: string): Promise<Either<TokenPairDto>> {
    let payload: RefreshJwtPayload;
    try {
      payload = this.jwtService.verify<RefreshJwtPayload>(refreshToken, {
        secret: this.configService.get<string>(EnvNames.JWT_REFRESH_SECRET),
      });
    } catch {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE);
    }

    if (payload.type !== 'refresh') {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const user = await this.userAccessor.findByEmail(payload.email);
    if (!user) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const freshPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return buildData(this.issueTokenPair(freshPayload));
  }

  async me(email: string): Promise<Either<MeDto>> {
    const user = await this.userAccessor.findByEmail(email);
    if (!user) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
    }

    return buildData({ id: user.id, email: user.email, role: user.role });
  }

  /**
   * Cookie lifetime read back off the token itself, so it can never drift from
   * JWT_REFRESH_EXPIRES_IN.
   */
  refreshCookieMaxAgeMs(refreshToken: string): number {
    const decoded = this.jwtService.decode<{ exp?: number } | null>(
      refreshToken,
    );
    if (!decoded?.exp) {
      return 0;
    }
    return Math.max(0, decoded.exp * 1000 - Date.now());
  }

  private issueTokenPair(payload: JwtPayload): TokenPairDto {
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>(EnvNames.JWT_SECRET),
      expiresIn: asExpiresIn(
        this.configService.get<string>(EnvNames.JWT_EXPIRES_IN)!,
      ),
    });

    const refreshPayload: RefreshJwtPayload = { ...payload, type: 'refresh' };
    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.get<string>(EnvNames.JWT_REFRESH_SECRET),
      expiresIn: asExpiresIn(
        this.configService.get<string>(EnvNames.JWT_REFRESH_EXPIRES_IN)!,
      ),
    });

    return { accessToken, refreshToken };
  }
}
