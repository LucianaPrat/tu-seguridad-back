import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SpaceMember, User } from '@prisma/client';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import {
  asExpiresIn,
  AccessTokenClaims,
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
  member: SpaceMember | null;
}

/**
 * Owns everything about a session: which claims a token carries, the
 * `auth_tokens` row behind each refresh token, and the single definition of who
 * is allowed to hold one — an active account. A membership is optional: an
 * account in no space still gets a session, scoped to nothing.
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
   * face login, invitation acceptance and profile completion. A deactivated or
   * missing account has no session; an account with no membership does, and
   * comes back with `member: null`.
   *
   * Which space the session lands in: the one the caller asked to stay in
   * (refresh), then the last one it used, then the most recently joined. Each
   * candidate only counts if the user is still a member there.
   */
  async loadActiveMembership(
    userId: number,
    preferredSpaceId?: string | null,
  ): Promise<ActiveMembership | null> {
    const user = await this.userAccessor.findById(userId);
    if (!user?.isActive) {
      return null;
    }

    for (const spaceId of [preferredSpaceId, user.lastSpaceId]) {
      if (!spaceId) {
        continue;
      }
      const member = await this.spaceMemberAccessor.findBySpaceAndUser(
        spaceId,
        userId,
      );
      if (member) {
        return { user, member };
      }
    }

    const member = await this.spaceMemberAccessor.findLatestByUserId(userId);
    return { user, member };
  }

  async issue(
    user: User,
    member: SpaceMember | null,
    context: SessionContext,
  ): Promise<TokenPairDto> {
    const claims = this.claimsOf(user, member);
    if (member && user.lastSpaceId !== member.spaceId) {
      await this.userAccessor.setLastSpaceId(user.id, member.spaceId);
    }
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
   * database, so a profile completion reaches the client on the next refresh
   * rather than at the next login. The refresh stays in the space the old token
   * was in, so it never silently lands the user in another one.
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

    const session = await this.loadActiveMembership(
      payload.sub,
      payload.spaceId,
    );
    if (!session) {
      return buildError(ErrorCode.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const claims = this.claimsOf(session.user, session.member);
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

  private claimsOf(user: User, member: SpaceMember | null): AccessTokenClaims {
    return {
      sub: user.id,
      email: user.email,
      spaceId: member?.spaceId ?? null,
      profileCompleted: user.profileCompleted,
    };
  }

  private signAccessToken(claims: AccessTokenClaims): string {
    return this.jwtService.sign(claims, {
      secret: this.configService.get<string>(EnvNames.JWT_SECRET),
      expiresIn: asExpiresIn(
        this.configService.get<string>(EnvNames.JWT_EXPIRES_IN)!,
      ),
    });
  }

  private signRefreshToken(claims: AccessTokenClaims): string {
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
