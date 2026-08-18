import { ExecutionContext, HttpException } from '@nestjs/common';
import { ErrorCode } from '../common/constants';
import { JwtPayload } from '../common/jwt-payload.type';
import { RequestWithUser } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  const member: JwtPayload = {
    sub: 1,
    email: 'member@example.com',
    spaceId: 'space-1',
    role: 'member',
    profileCompleted: true,
  };

  function contextFor(user?: JwtPayload): ExecutionContext {
    const request: Partial<RequestWithUser> = { user };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  /** `getAllAndOverride` is called for the public flag first, then for the roles. */
  function metadata(isPublic: boolean, roles?: string[]): void {
    reflector.getAllAndOverride
      .mockReturnValueOnce(isPublic)
      .mockReturnValueOnce(roles);
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as never);
  });

  it('allows a public route without looking at the roles', () => {
    metadata(true);

    expect(guard.canActivate(contextFor())).toBe(true);
  });

  it('allows a route that declares no role', () => {
    metadata(false, undefined);

    expect(guard.canActivate(contextFor(member))).toBe(true);
  });

  it('allows a member whose role is listed', () => {
    metadata(false, ['member', 'admin']);

    expect(guard.canActivate(contextFor(member))).toBe(true);
  });

  it('rejects a member on an admin-only route with FORBIDDEN', () => {
    metadata(false, ['admin']);

    expect.assertions(2);
    try {
      guard.canActivate(contextFor(member));
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toMatchObject({
        statusCode: 403,
        code: ErrorCode.FORBIDDEN,
      });
    }
  });

  it('rejects rather than falls open when the request carries no user', () => {
    metadata(false, ['admin']);

    expect(() => guard.canActivate(contextFor())).toThrow(HttpException);
  });
});
