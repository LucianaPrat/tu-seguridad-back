export interface JwtPayload {
  sub: number;
  email: string;
  role: string;
}

export interface RefreshJwtPayload extends JwtPayload {
  type: 'refresh';
}

type ExpiresIn = NonNullable<import('@nestjs/jwt').JwtSignOptions['expiresIn']>;

/**
 * `JwtSignOptions.expiresIn` is typed against a template-literal `ms.StringValue`
 * (e.g. `'15m'`), but env vars always come back as plain `string`. Values here
 * are validated by Joi at boot, so the runtime shape is guaranteed.
 */
export const asExpiresIn = (value: string): ExpiresIn =>
  value as unknown as ExpiresIn;
