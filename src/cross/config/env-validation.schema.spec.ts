import { EnvNames } from '../common/constants';
import { envValidationSchema } from './env-validation.schema';

// Joi types its result value as `any`; narrow it once here instead of at every assertion.
const validate = (env: Record<string, string>) => {
  const result = envValidationSchema.validate(env);
  return {
    error: result.error,
    value: result.value as Record<string, string>,
  };
};

// Everything else the schema demands once NODE_ENV is production, so each case below fails or
// passes on ADMIN_PASSWORD alone.
const productionEnv = {
  [EnvNames.NODE_ENV]: 'production',
  [EnvNames.JWT_SECRET]: 'production-access-secret',
  [EnvNames.JWT_REFRESH_SECRET]: 'production-refresh-secret',
  [EnvNames.DATABASE_URL]: 'mysql://user:pass@127.0.0.1:3306/tu-seguridad',
  [EnvNames.FACE_AUTH_API_URL]: 'https://api.face-auth.me',
  [EnvNames.FACE_AUTH_DOMAIN]: 'tenant-domain',
  [EnvNames.FACE_AUTH_TOKEN]: 'tenant-token',
};

describe('envValidationSchema', () => {
  describe('ADMIN_PASSWORD', () => {
    // The seed builds an active, profile-complete admin that owns the space and holds the admin
    // membership. Booting production without a real password would leave that account on the
    // placeholder committed in .env.example.
    it('rejects a production boot with no admin password', () => {
      const { error } = validate(productionEnv);

      expect(error?.message).toContain(EnvNames.ADMIN_PASSWORD);
    });

    it('rejects a production admin password below the minimum length', () => {
      const { error } = validate({
        ...productionEnv,
        [EnvNames.ADMIN_PASSWORD]: 'short-secret',
      });

      expect(error?.message).toContain('length must be at least 16');
    });

    it('accepts a production admin password at the minimum length', () => {
      const { error, value } = validate({
        ...productionEnv,
        [EnvNames.ADMIN_PASSWORD]: 'sixteen-char-pwd',
      });

      expect(error).toBeUndefined();
      expect(value[EnvNames.ADMIN_PASSWORD]).toBe('sixteen-char-pwd');
    });

    it('keeps the placeholder default outside production', () => {
      const { error, value } = validate({
        [EnvNames.NODE_ENV]: 'development',
      });

      expect(error).toBeUndefined();
      expect(value[EnvNames.ADMIN_PASSWORD]).toBe('change-me');
    });
  });
});
