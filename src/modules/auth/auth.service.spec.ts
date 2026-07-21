import * as bcrypt from 'bcrypt';
import { ErrorCode } from '../../cross/common/constants';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

describe('AuthService', () => {
  const user = {
    id: 1,
    email: 'admin@example.com',
    passwordHash: 'hashed',
    role: 'admin',
  };

  let userAccessor: { findByEmail: jest.Mock };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let configService: { get: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    userAccessor = { findByEmail: jest.fn() };
    jwtService = { sign: jest.fn(), verify: jest.fn() };
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          JWT_SECRET: 'access-secret',
          JWT_EXPIRES_IN: '15m',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_REFRESH_EXPIRES_IN: '7d',
        };
        return values[key];
      }),
    };
    service = new AuthService(
      userAccessor as never,
      jwtService as never,
      configService as never,
    );
    (bcrypt.compare as jest.Mock).mockReset();
    jwtService.sign
      .mockReset()
      .mockImplementation(
        (_payload: unknown, opts: { secret: string }) =>
          `signed-with-${opts.secret}`,
      );
  });

  describe('login', () => {
    it('returns UNAUTHORIZED when the user does not exist', async () => {
      userAccessor.findByEmail.mockResolvedValue(null);

      const result = await service.login('missing@example.com', 'whatever');

      expect(result).toEqual({
        ok: false,
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid email or password',
      });
    });

    it('returns UNAUTHORIZED on wrong password', async () => {
      userAccessor.findByEmail.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.login(user.email, 'wrong-password');

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    });

    it('returns a signed access/refresh token pair on success', async () => {
      userAccessor.findByEmail.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(user.email, 'correct-password');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.accessToken).toBe('signed-with-access-secret');
        expect(result.data.refreshToken).toBe('signed-with-refresh-secret');
      }
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: user.id, email: user.email }),
        expect.objectContaining({ secret: 'access-secret' }),
      );
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'refresh' }),
        expect.objectContaining({ secret: 'refresh-secret' }),
      );
    });
  });

  describe('refresh', () => {
    it('rejects a garbage/expired refresh token', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      const result = await service.refresh('garbage');

      expect(result).toEqual({
        ok: false,
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid or expired refresh token',
      });
    });

    it('rejects an access token presented as a refresh token', async () => {
      jwtService.verify.mockReturnValue({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      const result = await service.refresh('access-token-not-refresh');

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    });

    it('rejects when the user behind the token no longer exists', async () => {
      jwtService.verify.mockReturnValue({
        sub: user.id,
        email: user.email,
        role: user.role,
        type: 'refresh',
      });
      userAccessor.findByEmail.mockResolvedValue(null);

      const result = await service.refresh('valid-refresh-token');

      expect(result).toMatchObject({ code: ErrorCode.UNAUTHORIZED });
    });

    it('rotates the pair for a valid refresh token', async () => {
      jwtService.verify.mockReturnValue({
        sub: user.id,
        email: user.email,
        role: user.role,
        type: 'refresh',
      });
      userAccessor.findByEmail.mockResolvedValue(user);

      const result = await service.refresh('valid-refresh-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.accessToken).toBe('signed-with-access-secret');
        expect(result.data.refreshToken).toBe('signed-with-refresh-secret');
      }
    });
  });
});
