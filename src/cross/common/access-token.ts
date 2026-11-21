import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { buildData, buildError, Either } from '../errors/either';
import { EnvNames, ErrorCode } from './constants';
import { AccessTokenClaims, RefreshJwtPayload } from './jwt-payload.type';

/**
 * The one place an access token becomes claims.
 *
 * `JwtAuthGuard` calls it for every bearer-protected route. The MediaMTX
 * authorization hook calls it for a token that arrives in a JSON body instead
 * of a header, because the media server forwards the reader's credential, not
 * the reader's request — so the guard never sees it. Two verifiers would drift,
 * and a drift between them is a hole rather than a bug.
 *
 * Failures come back as `Either` so each caller can shape its own rejection:
 * the guard throws a mapped `HttpException`, the hook answers the media server.
 */
export const verifyAccessToken = (
  jwtService: JwtService,
  configService: ConfigService,
  token: string | undefined,
): Either<AccessTokenClaims> => {
  if (!token) {
    return buildError(ErrorCode.UNAUTHORIZED, 'Missing bearer token');
  }

  let payload: AccessTokenClaims & Partial<RefreshJwtPayload>;
  try {
    payload = jwtService.verify(token, {
      secret: configService.get<string>(EnvNames.JWT_SECRET),
    });
  } catch {
    return buildError(ErrorCode.UNAUTHORIZED, 'Invalid or expired token');
  }

  if (payload.type === 'refresh') {
    return buildError(
      ErrorCode.UNAUTHORIZED,
      'Refresh token cannot be used to access this resource',
    );
  }

  // A token signed before the tenant claims existed has no `spaceId` key at
  // all, which is different from `spaceId: null` (an account in no space yet).
  // Reject the former so `undefined` never reaches a downstream accessor.
  if (!('spaceId' in payload)) {
    return buildError(
      ErrorCode.UNAUTHORIZED,
      'Token carries no space membership',
    );
  }

  return buildData({
    sub: payload.sub,
    email: payload.email,
    spaceId: payload.spaceId || null,
    profileCompleted: payload.profileCompleted === true,
  });
};
