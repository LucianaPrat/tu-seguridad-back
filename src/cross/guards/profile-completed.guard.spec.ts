import { ExecutionContext, HttpException } from '@nestjs/common';
import { ErrorCode } from '../common/constants';
import { JwtPayload } from '../common/jwt-payload.type';
import { RequestWithUser } from './jwt-auth.guard';
import { ProfileCompletedGuard } from './profile-completed.guard';

describe('ProfileCompletedGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: ProfileCompletedGuard;

  const invitedUser: JwtPayload = {
    sub: 7,
    email: 'invited@example.com',
    spaceId: 'space-1',
    role: 'member',
    profileCompleted: false,
  };

  function contextFor(user?: JwtPayload): ExecutionContext {
    const request: Partial<RequestWithUser> = { user };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  /** Public flag is read first, then the incomplete-profile allowance. */
  function metadata(isPublic: boolean, allowsIncomplete?: boolean): void {
    reflector.getAllAndOverride
      .mockReturnValueOnce(isPublic)
      .mockReturnValueOnce(allowsIncomplete);
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new ProfileCompletedGuard(reflector as never);
  });

  it('allows a public route', () => {
    metadata(true);

    expect(guard.canActivate(contextFor())).toBe(true);
  });

  it('allows an incomplete profile onto a route that opted in', () => {
    metadata(false, true);

    expect(guard.canActivate(contextFor(invitedUser))).toBe(true);
  });

  it('blocks an incomplete profile everywhere else with FORBIDDEN', () => {
    metadata(false, false);

    expect.assertions(2);
    try {
      guard.canActivate(contextFor(invitedUser));
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toMatchObject({
        statusCode: 403,
        code: ErrorCode.FORBIDDEN,
      });
    }
  });

  it('allows a completed profile', () => {
    metadata(false, false);

    expect(
      guard.canActivate(contextFor({ ...invitedUser, profileCompleted: true })),
    ).toBe(true);
  });

  it('rejects rather than falls open when the request carries no user', () => {
    metadata(false, false);

    expect(() => guard.canActivate(contextFor())).toThrow(HttpException);
  });
});
