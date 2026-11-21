import type { SpaceMemberRole } from '@prisma/client';
import type { MenuKey } from './permissions';

/**
 * What a token carries. `spaceId` is the space the session is currently in, or
 * `null` for an account that belongs to none yet. Role and permissions are
 * deliberately absent: they are read from `space_members` on every request by
 * `SpaceMemberGuard`, so a role change or a removal applies immediately instead
 * of at the next token.
 *
 * `profileCompleted` is a claim rather than a per-request database read: it
 * gates every route except profile completion itself, and completing the
 * profile issues a fresh pair. The cost is that the flag is only as fresh as
 * `JWT_EXPIRES_IN`, which is also true of `isActive` — deactivation takes
 * effect at the next login or refresh.
 */
export interface AccessTokenClaims {
  sub: number;
  email: string;
  spaceId: string | null;
  profileCompleted: boolean;
}

/**
 * The request principal for a space-scoped route: the token's claims plus the
 * caller's membership as it is in the database right now. Built by
 * `SpaceMemberGuard`, never signed into a token.
 */
export interface JwtPayload {
  sub: number;
  email: string;
  spaceId: string;
  role: SpaceMemberRole;
  profileCompleted: boolean;
  menuAccess: MenuKey[];
  cameraIds: string[];
  receiveAlerts: boolean;
}

/**
 * `jti` is what makes two refresh tokens for the same session distinct. Without
 * it, a refresh inside the same second as the previous issuance re-signs an
 * identical payload — same string, same hash — and the rotation write dies on
 * the `auth_tokens.token_hash` unique constraint.
 */
export interface RefreshJwtPayload extends AccessTokenClaims {
  type: 'refresh';
  jti: string;
}

type ExpiresIn = NonNullable<import('@nestjs/jwt').JwtSignOptions['expiresIn']>;

/**
 * `JwtSignOptions.expiresIn` is typed against a template-literal `ms.StringValue`
 * (e.g. `'15m'`), but env vars always come back as plain `string`. Values here
 * are validated by Joi at boot, so the runtime shape is guaranteed.
 */
export const asExpiresIn = (value: string): ExpiresIn =>
  value as unknown as ExpiresIn;
