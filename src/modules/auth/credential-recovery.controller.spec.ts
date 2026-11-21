import { Response } from 'express';
import { ErrorCode } from '../../cross/common/constants';
import { SessionContext } from '../../cross/common/session-context.type';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { CredentialRecoveryController } from './credential-recovery.controller';
import { AccessTokenDto } from './dto/access-token.dto';
import { AcknowledgementDto } from './dto/acknowledgement.dto';
import { TokenPairDto } from './dto/token-pair.dto';

const ACCEPTED: Either<AcknowledgementDto> = buildData({ accepted: true });
const CONTEXT: SessionContext = { userAgent: 'jest', ip: '127.0.0.1' };

describe('CredentialRecoveryController', () => {
  let recoveryService: {
    requestPasswordReset: jest.Mock;
    confirmPasswordReset: jest.Mock;
    requestMagicLink: jest.Mock;
    consumeMagicLink: jest.Mock;
  };
  let refreshCookie: { issueSession: jest.Mock };
  let res: Response;
  let controller: CredentialRecoveryController;

  beforeEach(() => {
    recoveryService = {
      requestPasswordReset: jest.fn().mockResolvedValue(ACCEPTED),
      confirmPasswordReset: jest.fn().mockResolvedValue(ACCEPTED),
      requestMagicLink: jest.fn().mockResolvedValue(ACCEPTED),
      consumeMagicLink: jest.fn(),
    };
    refreshCookie = { issueSession: jest.fn() };
    res = {} as Response;
    controller = new CredentialRecoveryController(
      recoveryService as never,
      refreshCookie as never,
    );
  });

  it('delegates requestPasswordReset with the dto email', async () => {
    const result = await controller.requestPasswordReset({
      email: 'a@a.com',
    });

    expect(recoveryService.requestPasswordReset).toHaveBeenCalledWith(
      'a@a.com',
    );
    expect(result).toBe(ACCEPTED);
  });

  it('delegates confirmPasswordReset with the dto token and password', async () => {
    const result = await controller.confirmPasswordReset({
      token: 'reset-token',
      password: 'new-password',
    });

    expect(recoveryService.confirmPasswordReset).toHaveBeenCalledWith(
      'reset-token',
      'new-password',
    );
    expect(result).toBe(ACCEPTED);
  });

  it('delegates requestMagicLink with the dto email', async () => {
    const result = await controller.requestMagicLink({ email: 'a@a.com' });

    expect(recoveryService.requestMagicLink).toHaveBeenCalledWith('a@a.com');
    expect(result).toBe(ACCEPTED);
  });

  describe('consumeMagicLink', () => {
    it('delegates to the recovery service with the dto token and request context', async () => {
      recoveryService.consumeMagicLink.mockResolvedValue(
        buildData<TokenPairDto>({
          accessToken: 'atoken',
          refreshToken: 'rtoken',
        }),
      );
      refreshCookie.issueSession.mockReturnValue(
        buildData<AccessTokenDto>({ accessToken: 'atoken' }),
      );

      await controller.consumeMagicLink({ token: 'magic-token' }, CONTEXT, res);

      expect(recoveryService.consumeMagicLink).toHaveBeenCalledWith(
        'magic-token',
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
      recoveryService.consumeMagicLink.mockResolvedValue(serviceResult);
      refreshCookie.issueSession.mockReturnValue(cookieResult);

      const result = await controller.consumeMagicLink(
        { token: 'magic-token' },
        CONTEXT,
        res,
      );

      expect(refreshCookie.issueSession).toHaveBeenCalledWith(
        res,
        serviceResult,
      );
      expect(result).toBe(cookieResult);
    });

    it('passes a failed consume straight to refreshCookie without touching it', async () => {
      const failure = buildError<TokenPairDto>(
        ErrorCode.UNAUTHORIZED,
        'Invalid or expired token',
      );
      recoveryService.consumeMagicLink.mockResolvedValue(failure);
      refreshCookie.issueSession.mockReturnValue(failure);

      const result = await controller.consumeMagicLink(
        { token: 'bad-token' },
        CONTEXT,
        res,
      );

      expect(refreshCookie.issueSession).toHaveBeenCalledWith(res, failure);
      expect(result).toBe(failure);
    });
  });
});
