import { Request, Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import { AuthController } from './auth.controller';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './refresh-cookie';

interface AuthServiceMock {
  login: jest.Mock;
  refresh: jest.Mock;
  me: jest.Mock;
  refreshCookieMaxAgeMs: jest.Mock;
}

describe('AuthController', () => {
  let authService: AuthServiceMock;
  let configService: { get: jest.Mock };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };
  let controller: AuthController;

  const TOKEN_PAIR = { accessToken: 'atoken', refreshToken: 'rtoken' };

  function requestWithCookies(cookies: Record<string, string>): Request {
    return { cookies } as unknown as Request;
  }

  beforeEach(() => {
    authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      me: jest.fn(),
      refreshCookieMaxAgeMs: jest.fn().mockReturnValue(604_800_000),
    };
    configService = { get: jest.fn().mockReturnValue('development') };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
    controller = new AuthController(
      authService as never,
      configService as never,
    );
  });

  describe('login', () => {
    it('delegates to AuthService with the dto fields', async () => {
      authService.login.mockResolvedValue({ ok: true, data: TOKEN_PAIR });

      await controller.login(
        { email: 'a@a.com', password: 'secret' },
        res as unknown as Response,
      );

      expect(authService.login).toHaveBeenCalledWith('a@a.com', 'secret');
    });

    it('puts the refresh token in an HttpOnly cookie and keeps it out of the body', async () => {
      authService.login.mockResolvedValue({ ok: true, data: TOKEN_PAIR });

      const result = await controller.login(
        { email: 'a@a.com', password: 'secret' },
        res as unknown as Response,
      );

      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'rtoken',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: REFRESH_COOKIE_PATH,
        }),
      );
      expect(result).toEqual({ ok: true, data: { accessToken: 'atoken' } });
    });

    it('sets no cookie when the credentials are rejected', async () => {
      const failure = { ok: false, code: ErrorCode.UNAUTHORIZED };
      authService.login.mockResolvedValue(failure);

      const result = await controller.login(
        { email: 'a@a.com', password: 'wrong' },
        res as unknown as Response,
      );

      expect(res.cookie).not.toHaveBeenCalled();
      expect(result).toBe(failure);
    });
  });

  describe('refresh', () => {
    it('reads the refresh token off the cookie', async () => {
      authService.refresh.mockResolvedValue({ ok: true, data: TOKEN_PAIR });

      await controller.refresh(
        requestWithCookies({ [REFRESH_COOKIE_NAME]: 'cookie-token' }),
        res as unknown as Response,
      );

      expect(authService.refresh).toHaveBeenCalledWith('cookie-token');
    });

    it('rotates the cookie and returns only the access token', async () => {
      authService.refresh.mockResolvedValue({ ok: true, data: TOKEN_PAIR });

      const result = await controller.refresh(
        requestWithCookies({ [REFRESH_COOKIE_NAME]: 'cookie-token' }),
        res as unknown as Response,
      );

      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'rtoken',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result).toEqual({ ok: true, data: { accessToken: 'atoken' } });
    });

    it('rejects with UNAUTHORIZED when no cookie is present', async () => {
      const result = await controller.refresh(
        requestWithCookies({}),
        res as unknown as Response,
      );

      expect(authService.refresh).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: false,
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid or expired refresh token',
      });
    });

    it('ignores a body-supplied refresh token — the cookie is the only source', async () => {
      const result = await controller.refresh(
        {
          cookies: {},
          body: { refreshToken: 'from-body' },
        } as unknown as Request,
        res as unknown as Response,
      );

      expect(authService.refresh).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ok: false });
    });
  });

  describe('logout', () => {
    it('clears the refresh cookie on the scoped path', () => {
      controller.logout(res as unknown as Response);

      expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, {
        path: REFRESH_COOKIE_PATH,
      });
    });
  });

  describe('me', () => {
    it('delegates to AuthService with the email off the token payload', async () => {
      authService.me.mockResolvedValue({ ok: true, data: {} });

      await controller.me({ sub: 1, email: 'a@a.com', role: 'admin' });

      expect(authService.me).toHaveBeenCalledWith('a@a.com');
    });
  });

  describe('secure flag', () => {
    it('marks the cookie secure in production', async () => {
      configService.get.mockReturnValue('production');
      authService.login.mockResolvedValue({ ok: true, data: TOKEN_PAIR });

      await controller.login(
        { email: 'a@a.com', password: 'secret' },
        res as unknown as Response,
      );

      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'rtoken',
        expect.objectContaining({ secure: true }),
      );
    });
  });
});
