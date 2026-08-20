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
  // 32 bytes, and deliberately not the all-zero placeholder the dev default carries.
  [EnvNames.DVR_PASSWORD_ENCRYPTION_KEY]:
    'dGVuYW50LWFsZXJ0LXRlc3Qta2V5LTMyLWJ5dGVzISE=',
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

  describe('DVR_PASSWORD_ENCRYPTION_KEY', () => {
    const PLACEHOLDER = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const withAdminPassword = {
      ...productionEnv,
      [EnvNames.ADMIN_PASSWORD]: 'sixteen-char-pwd',
    };

    it('rejects a production boot with no encryption key', () => {
      const env = Object.fromEntries(
        Object.entries(withAdminPassword).filter(
          ([name]) => name !== EnvNames.DVR_PASSWORD_ENCRYPTION_KEY,
        ),
      );

      const { error } = validate(env);

      expect(error?.message).toContain(EnvNames.DVR_PASSWORD_ENCRYPTION_KEY);
    });

    // The placeholder is committed in .env.example and decodes to 32 valid
    // bytes, so the length check alone lets a copied example file through.
    it('rejects the .env.example placeholder in production', () => {
      const { error } = validate({
        ...withAdminPassword,
        [EnvNames.DVR_PASSWORD_ENCRYPTION_KEY]: PLACEHOLDER,
      });

      expect(error?.message).toContain('.env.example');
    });

    // The last base64 character of a 32-byte value carries two unconstrained
    // padding bits, so the all-zero key has four spellings. A string comparison
    // would only catch the one committed in .env.example, and an operator who
    // edits that one character instead of generating a key would sail through.
    it.each(['A=', 'B=', 'C=', 'D='])(
      'rejects every base64 spelling of the placeholder key in production (...%s)',
      (tail) => {
        const { error } = validate({
          ...withAdminPassword,
          [EnvNames.DVR_PASSWORD_ENCRYPTION_KEY]: 'A'.repeat(42) + tail,
        });

        expect(error?.message).toContain('.env.example');
      },
    );

    it('rejects a production key that does not decode to 32 bytes', () => {
      const { error } = validate({
        ...withAdminPassword,
        [EnvNames.DVR_PASSWORD_ENCRYPTION_KEY]: 'dG9vLXNob3J0',
      });

      expect(error?.message).toContain('32 bytes');
    });

    it('accepts a real 32-byte production key', () => {
      const { error, value } = validate(withAdminPassword);

      expect(error).toBeUndefined();
      expect(value[EnvNames.DVR_PASSWORD_ENCRYPTION_KEY]).toBe(
        productionEnv[EnvNames.DVR_PASSWORD_ENCRYPTION_KEY],
      );
    });

    // Outside production the placeholder is the point: a fresh clone boots
    // without an operator generating a key first.
    it('keeps the placeholder default outside production', () => {
      const { error, value } = validate({
        [EnvNames.NODE_ENV]: 'development',
      });

      expect(error).toBeUndefined();
      expect(value[EnvNames.DVR_PASSWORD_ENCRYPTION_KEY]).toBe(PLACEHOLDER);
    });
  });

  // The DVR key was the first placeholder production learned to reject. Every
  // other one is committed in the same file, and `.required()` alone lets it
  // through because the variable *is* set — a boot on the published JWT secret
  // would let anyone with repo access mint an admin token for any space.
  describe('placeholder secrets', () => {
    const withAdminPassword = {
      ...productionEnv,
      [EnvNames.ADMIN_PASSWORD]: 'sixteen-char-pwd',
    };

    it.each([
      [EnvNames.JWT_SECRET, 'change-me'],
      [EnvNames.JWT_REFRESH_SECRET, 'change-me-too'],
      [EnvNames.FACE_AUTH_DOMAIN, 'change-me'],
      [EnvNames.FACE_AUTH_TOKEN, 'change-me'],
      [
        EnvNames.DATABASE_URL,
        'mysql://USER:PASSWORD@127.0.0.1:3306/tu-seguridad',
      ],
    ])(
      'rejects the .env.example placeholder for %s in production',
      (name, placeholder) => {
        const { error } = validate({
          ...withAdminPassword,
          [name]: placeholder,
        });

        expect(error?.message).toContain(name);
        expect(error?.message).toContain('.env.example');
      },
    );

    // FACE_AUTH_API_URL is the exception the rule has to keep: its dev default
    // is the real upstream, not a placeholder, so production must be allowed to
    // send exactly that value.
    it('accepts a production value that equals a real, non-placeholder default', () => {
      const { error } = validate({
        ...withAdminPassword,
        [EnvNames.FACE_AUTH_API_URL]: 'https://api.face-auth.me',
      });

      expect(error).toBeUndefined();
    });

    it('keeps every placeholder as the default outside production', () => {
      const { error, value } = validate({
        [EnvNames.NODE_ENV]: 'development',
      });

      expect(error).toBeUndefined();
      expect(value[EnvNames.JWT_SECRET]).toBe('change-me');
      expect(value[EnvNames.JWT_REFRESH_SECRET]).toBe('change-me-too');
      expect(value[EnvNames.FACE_AUTH_TOKEN]).toBe('change-me');
    });
  });
});
