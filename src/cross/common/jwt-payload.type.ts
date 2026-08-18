import type { SpaceMemberRole } from '@prisma/client';

/**
 * Access-token claims. `spaceId` and `role` come from the caller's single
 * `space_members` row, resolved once at sign time, so a request never has to
 * derive its tenant from a resource id.
 *
 * `profileCompleted` is a claim rather than a per-request database read: it
 * gates every route except profile completion itself, and completing the
 * profile issues a fresh pair. The cost is that the flag is only as fresh as
 * `JWT_EXPIRES_IN`, which is also true of `isActive` — deactivation takes
 * effect at the next login or refresh.
 */
export interface JwtPayload {
  sub: number;
  email: string;
  spaceId: string;
  role: SpaceMemberRole;
  profileCompleted: boolean;
}

/**
 * `jti` is what makes two refresh tokens for the same session distinct. Without
 * it, a refresh inside the same second as the previous issuance re-signs an
 * identical payload — same string, same hash — and the rotation write dies on
 * the `auth_tokens.token_hash` unique constraint.
 */
export interface RefreshJwtPayload extends JwtPayload {
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
