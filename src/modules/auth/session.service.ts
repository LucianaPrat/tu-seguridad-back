import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SpaceMember, User } from '@prisma/client';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import {
  asExpiresIn,
  JwtPayload,
  RefreshJwtPayload,
} from '../../cross/common/jwt-payload.type';
import { SessionContext } from '../../cross/common/session-context.type';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { AuthTokenAccessorService } from '../../data/accessors/auth-token.accessor';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { UserAccessorService } from '../../data/accessors/user.accessor';
import { TokenPairDto } from './dto/token-pair.dto';

export const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid or expired refresh token';

export interface ActiveMembership {
  user: User;
  member: SpaceMember;
}

/**
 * Owns everything about a session: which claims a token carries, the
 * `auth_tokens` row behind each refresh token, and the single definition of who
 * is allowed to hold one — an active account with an accepted membership.
 *
 * Refresh tokens stay signed JWTs (distinct secret, `type` discriminator) *and*
 * are persisted as hashes, so a stolen cookie can be revoked instead of staying
 * valid for its whole lifetime.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authTokenAccessor: AuthTokenAccessorService,
    private readonly userAccessor: UserAccessorService,
    private readonly spaceMemberAccessor: SpaceMemberAccessorService,
  ) {}

  /**
   * The one gate every session-issuing flow shares: login, refresh, magic link,
   * face login, invitation acceptance and profile completion. A deactivated
   * account or an account with no membership has no space to act in.
   */
  async loadActiveMembership(userId: number): Promise<ActiveMembership | null> {
    const user = await this.userAccessor.findById(userId);
    if (!user?.isActive) {
      return null;
    }
    const member = await this.spaceMemberAccessor.findByUserId(userId);
    return member ? { user, member } : null;
  }

  async issue(
    user: User,
    member: SpaceMember,
    context: SessionContext,
  ): Promise<TokenPairDto> {
    const claims: JwtPayload = {
      sub: user.id,
      email: user.email,
      spaceId: member.spaceId,
      role: member.role,
      profileCompleted: user.profileCompleted,
    };
    const refreshToken = this.signRefreshToken(claims);
    await this.authTokenAccessor.create({
      userId: user.id,
      purpose: 'refresh',
      token: refreshToken,
      expiresAt: this.expiresAtOf(refreshToken),
      userAgent: context.userAgent,
      ip: context.ip,
    });
    return { accessToken: this.signAccessToken(claims), refreshToken };
  }

  /**
   * Rotation, not re-signing: the presented token is revoked and its successor
   * recorded as rotated from it, in one transaction. Claims are rebuilt from the
   * database, so a role change or a profile completion reaches the client on the
   * next refresh rather than at the next login.
   */
  async rotate(
    refreshToken: string,
    context: SessionContext,
  ): Promise<Either<TokenPairDto>> {
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

    const session = await this.loadActiveMembership(payload.sub);
    if (!session) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const claims: JwtPayload = {
      sub: session.user.id,
      email: session.user.email,
      spaceId: session.member.spaceId,
      role: session.member.role,
      profileCompleted: session.user.profileCompleted,
    };
    const successor = this.signRefreshToken(claims);
    const rotated = await this.authTokenAccessor.rotateRefresh(refreshToken, {
      token: successor,
      userId: session.user.id,
      expiresAt: this.expiresAtOf(successor),
      userAgent: context.userAgent,
      ip: context.ip,
    });

    if (!rotated) {
      // The signature verified but no usable row is left: this token was already
      // rotated, revoked or expired. Either a replay of a stolen cookie or a
      // client racing itself — end the whole family and make both parties log in.
      await this.authTokenAccessor.revokeAllByUserAndPurpose(
        session.user.id,
        'refresh',
      );
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE);
    }

    return buildData({
      accessToken: this.signAccessToken(claims),
      refreshToken: successor,
    });
  }

  /** Logout. Unknown or already-revoked tokens are a no-op, never an error. */
  async revoke(refreshToken: string): Promise<void> {
    await this.authTokenAccessor.revoke('refresh', refreshToken);
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

  private signAccessToken(claims: JwtPayload): string {
    return this.jwtService.sign(claims, {
      secret: this.configService.get<string>(EnvNames.JWT_SECRET),
      expiresIn: asExpiresIn(
        this.configService.get<string>(EnvNames.JWT_EXPIRES_IN)!,
      ),
    });
  }

  private signRefreshToken(claims: JwtPayload): string {
    const payload: RefreshJwtPayload = {
      ...claims,
      type: 'refresh',
      jti: randomUUID(),
    };
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>(EnvNames.JWT_REFRESH_SECRET),
      expiresIn: asExpiresIn(
        this.configService.get<string>(EnvNames.JWT_REFRESH_EXPIRES_IN)!,
      ),
    });
  }

  /** The stored row expires exactly when the token does, off the same claim. */
  private expiresAtOf(token: string): Date {
    const decoded = this.jwtService.decode<{ exp?: number } | null>(token);
    if (!decoded?.exp) {
      throw new Error('Refresh token was signed without an exp claim');
    }
    return new Date(decoded.exp * 1000);
  }
}
