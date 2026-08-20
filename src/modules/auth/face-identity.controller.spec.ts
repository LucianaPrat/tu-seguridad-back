import { Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import { JwtPayload } from '../../cross/common/jwt-payload.type';
import { SessionContext } from '../../cross/common/session-context.type';
import { buildData, buildError } from '../../cross/errors/either';
import { AccessTokenDto } from './dto/access-token.dto';
import { FaceIdentityDto } from './dto/face-identity.dto';
import { TokenPairDto } from './dto/token-pair.dto';
import { FaceIdentityController } from './face-identity.controller';

const CONTEXT: SessionContext = { userAgent: 'jest', ip: '127.0.0.1' };

describe('FaceIdentityController', () => {
  const user: JwtPayload = {
    sub: 1,
    email: 'owner@example.com',
    spaceId: 'space-uuid',
    role: 'admin',
    profileCompleted: true,
  };

  let faceIdentityService: { register: jest.Mock; login: jest.Mock };
  let refreshCookie: { issueSession: jest.Mock };
  let res: Response;
  let controller: FaceIdentityController;

  beforeEach(() => {
    faceIdentityService = {
      register: jest.fn(),
      login: jest.fn(),
    };
    refreshCookie = { issueSession: jest.fn() };
    res = {} as Response;
    controller = new FaceIdentityController(
      faceIdentityService as never,
      refreshCookie as never,
    );
  });

  describe('register', () => {
    it('delegates with the caller id and the dto face token', async () => {
      const result = buildData<FaceIdentityDto>({
        id: 'identity-uuid',
        createdAt: new Date('2026-01-01'),
      });
      faceIdentityService.register.mockResolvedValue(result);

      const returned = await controller.register(user, {
        faceToken: 'face-token',
      });

      expect(faceIdentityService.register).toHaveBeenCalledWith(
        1,
        'face-token',
      );
      expect(returned).toBe(result);
    });

    it("uses the caller's own id, not a fixed one", async () => {
      const otherUser: JwtPayload = { ...user, sub: 42 };
      faceIdentityService.register.mockResolvedValue(
        buildData<FaceIdentityDto>({
          id: 'identity-uuid',
          createdAt: new Date('2026-01-01'),
        }),
      );

      await controller.register(otherUser, { faceToken: 'face-token' });

      expect(faceIdentityService.register).toHaveBeenCalledWith(
        42,
        'face-token',
      );
    });
  });

  describe('login', () => {
    it('delegates to the service with the dto face token and request context', async () => {
      faceIdentityService.login.mockResolvedValue(
        buildData<TokenPairDto>({
          accessToken: 'atoken',
          refreshToken: 'rtoken',
        }),
      );
      refreshCookie.issueSession.mockReturnValue(
        buildData<AccessTokenDto>({ accessToken: 'atoken' }),
      );

      await controller.login({ faceToken: 'face-token' }, CONTEXT, res);

      expect(faceIdentityService.login).toHaveBeenCalledWith(
        'face-token',
        CONTEXT,
      );
    });

    it('hands the service result to refreshCookie and returns its result as-is', async () => {
      const serviceResult = buildData<TokenPairDto>({
        accessToken: 'atoken',
        refreshToken: 'rtoken',
      });
      const cookieResult = buildData<AccessTokenDto>({
        accessToken: 'atoken',
      });
      faceIdentityService.login.mockResolvedValue(serviceResult);
      refreshCookie.issueSession.mockReturnValue(cookieResult);

      const result = await controller.login(
        { faceToken: 'face-token' },
        CONTEXT,
        res,
      );

      expect(refreshCookie.issueSession).toHaveBeenCalledWith(
        res,
        serviceResult,
      );
      expect(result).toBe(cookieResult);
    });

    it('passes an unrecognized face straight to refreshCookie without touching it', async () => {
      const failure = buildError<TokenPairDto>(
        ErrorCode.UNAUTHORIZED,
        'Face identity is not recognized',
      );
      faceIdentityService.login.mockResolvedValue(failure);
      refreshCookie.issueSession.mockReturnValue(failure);

      const result = await controller.login(
        { faceToken: 'unknown-token' },
        CONTEXT,
        res,
      );

      expect(refreshCookie.issueSession).toHaveBeenCalledWith(res, failure);
      expect(result).toBe(failure);
    });
  });
});
