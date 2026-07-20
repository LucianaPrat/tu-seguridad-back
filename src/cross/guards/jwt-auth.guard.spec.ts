import { ExecutionContext, HttpException } from '@nestjs/common';
import { JwtAuthGuard, RequestWithUser } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let jwtService: { verify: jest.Mock };
  let configService: { get: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: JwtAuthGuard;

  function contextWithAuthHeader(header?: string): ExecutionContext {
    const request: Partial<RequestWithUser> = {
      headers: header ? { authorization: header } : {},
    };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('access-secret') };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new JwtAuthGuard(
      jwtService as never,
      configService as never,
      reflector as never,
    );
  });

  it('allows public routes without checking the token', () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    expect(guard.canActivate(contextWithAuthHeader())).toBe(true);
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('rejects a request with no bearer token', () => {
    expect(() => guard.canActivate(contextWithAuthHeader())).toThrow(
      HttpException,
    );
  });

  it('rejects a garbage/expired token', () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    expect(() =>
      guard.canActivate(contextWithAuthHeader('Bearer garbage')),
    ).toThrow(HttpException);
  });

  it('rejects a refresh token used as an access token', () => {
    jwtService.verify.mockReturnValue({
      sub: 1,
      email: 'admin@example.com',
      role: 'admin',
      type: 'refresh',
    });

    expect(() =>
      guard.canActivate(contextWithAuthHeader('Bearer refresh-token')),
    ).toThrow(HttpException);
  });

  it('allows a valid access token and attaches the user to the request', () => {
    jwtService.verify.mockReturnValue({
      sub: 1,
      email: 'admin@example.com',
      role: 'admin',
    });
    const context = contextWithAuthHeader('Bearer valid-token');

    expect(guard.canActivate(context)).toBe(true);

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    expect(request.user).toEqual({
      sub: 1,
      email: 'admin@example.com',
      role: 'admin',
    });
  });
});
