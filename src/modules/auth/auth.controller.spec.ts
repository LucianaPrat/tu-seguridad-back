import { Request, Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import { JwtPayload } from '../../cross/common/jwt-payload.type';
import { buildData, Either } from '../../cross/errors/either';
import { AuthController } from './auth.controller';
import { REFRESH_COOKIE_NAME } from './refresh-cookie';

const TOKEN_PAIR = { accessToken: 'atoken', refreshToken: 'rtoken' };
const CONTEXT = { userAgent: 'jest', ip: '127.0.0.1' };

describe('AuthController', () => {
  let authService: {
    login: jest.Mock;
    register: jest.Mock;
    completeProfile: jest.Mock;
    me: jest.Mock;
  };
  let sessionService: { rotate: jest.Mock; revoke: jest.Mock };
  let refreshCookie: { issueSession: jest.Mock; clear: jest.Mock };
  let res: Response;
  let controller: AuthController;

  const currentUser: JwtPayload = {
    sub: 1,
    email: 'owner@example.com',
    spaceId: 'space-1',
    role: 'admin',
    profileCompleted: true,
  };

  function requestWithCookies(cookies: Record<string, string>): Request {
    return { cookies } as unknown as Request;
  }

  beforeEach(() => {
    authService = {
      login: jest.fn().mockResolvedValue(buildData(TOKEN_PAIR)),
      register: jest.fn().mockResolvedValue(buildData(TOKEN_PAIR)),
      completeProfile: jest.fn().mockResolvedValue(buildData(TOKEN_PAIR)),
      me: jest.fn().mockResolvedValue(buildData({})),
    };
    sessionService = {
      rotate: jest.fn().mockResolvedValue(buildData(TOKEN_PAIR)),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    refreshCookie = {
      // Mirrors the real service: cookie on the way out, access token in the body.
      issueSession: jest
        .fn()
        .mockImplementation(
          (_res: Response, result: Either<typeof TOKEN_PAIR>) =>
            result.ok
              ? buildData({ accessToken: result.data.accessToken })
              : result,
        ),
      clear: jest.fn(),
    };
    res = {} as Response;
    controller = new AuthController(
      authService as never,
      sessionService as never,
      refreshCookie as never,
    );
  });

  describe('login', () => {
    it('delegates to AuthService with the dto fields and the request context', async () => {
      await controller.login(
        { email: 'a@a.com', password: 'secret' },
        CONTEXT,
        res,
      );

      expect(authService.login).toHaveBeenCalledWith(
        'a@a.com',
        'secret',
        CONTEXT,
      );
    });

    it('returns only the access token', async () => {
      const result = await controller.login(
        { email: 'a@a.com', password: 'secret' },
        CONTEXT,
        res,
      );

      expect(result).toEqual({ ok: true, data: { accessToken: 'atoken' } });
      expect(refreshCookie.issueSession).toHaveBeenCalledWith(
        res,
        buildData(TOKEN_PAIR),
      );
    });
  });

  describe('register', () => {
    it('delegates the dto and returns only the access token', async () => {
      const dto = {
        email: 'new@example.com',
        password: 'a-long-enough-password',
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '+5491122334455',
        spaceName: 'My Secure Space',
      };

      const result = await controller.register(dto, CONTEXT, res);

      expect(authService.register).toHaveBeenCalledWith(dto, CONTEXT);
      expect(result).toEqual({ ok: true, data: { accessToken: 'atoken' } });
    });
  });

  describe('refresh', () => {
    it('reads the refresh token off the cookie', async () => {
      await controller.refresh(
        requestWithCookies({ [REFRESH_COOKIE_NAME]: 'cookie-token' }),
        CONTEXT,
        res,
      );

      expect(sessionService.rotate).toHaveBeenCalledWith(
        'cookie-token',
        CONTEXT,
      );
    });

    it('rejects with UNAUTHORIZED when no cookie is present', async () => {
      const result = await controller.refresh(
        requestWithCookies({}),
        CONTEXT,
        res,
      );

      expect(sessionService.rotate).not.toHaveBeenCalled();
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
        CONTEXT,
        res,
      );

      expect(sessionService.rotate).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ok: false });
    });
  });

  describe('logout', () => {
    it('revokes the stored token and clears the cookie', async () => {
      await controller.logout(
        requestWithCookies({ [REFRESH_COOKIE_NAME]: 'cookie-token' }),
        res,
      );

      expect(sessionService.revoke).toHaveBeenCalledWith('cookie-token');
      expect(refreshCookie.clear).toHaveBeenCalledWith(res);
    });

    it('still clears the cookie when the request carried none', async () => {
      await controller.logout(requestWithCookies({}), res);

      expect(sessionService.revoke).not.toHaveBeenCalled();
      expect(refreshCookie.clear).toHaveBeenCalledWith(res);
    });
  });

  describe('me', () => {
    it('delegates with the user id off the token payload', async () => {
      await controller.me(currentUser);

      expect(authService.me).toHaveBeenCalledWith(1);
    });
  });

  describe('completeProfile', () => {
    it('delegates the caller id, the dto and the request context', async () => {
      const dto = {
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '+5491122334455',
        password: 'a-long-enough-password',
      };

      await controller.completeProfile(
        { ...currentUser, profileCompleted: false },
        dto,
        CONTEXT,
        res,
      );

      expect(authService.completeProfile).toHaveBeenCalledWith(1, dto, CONTEXT);
    });
  });
});
