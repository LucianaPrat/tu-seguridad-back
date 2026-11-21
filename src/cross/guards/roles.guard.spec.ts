import { ExecutionContext, HttpException } from '@nestjs/common';
import { ErrorCode } from '../common/constants';
import { buildPrincipal } from '../common/jwt-payload.fixture';
import type { JwtPayload } from '../common/jwt-payload.type';
import { RequestWithUser } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  const member = buildPrincipal({
    sub: 1,
    email: 'member@example.com',
    spaceId: 'space-1',
    role: 'collaborator',
    profileCompleted: true,
  });

  function contextFor(user?: JwtPayload): ExecutionContext {
    const request: Partial<RequestWithUser> = { user };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  /** `getAllAndOverride` is called for the public flag, then the roles, then the menu. */
  function metadata(isPublic: boolean, roles?: string[], menu?: string): void {
    reflector.getAllAndOverride
      .mockReturnValueOnce(isPublic)
      .mockReturnValueOnce(roles)
      .mockReturnValueOnce(menu);
  }

  function forbidden(user: JwtPayload | undefined, message: string): void {
    expect.assertions(3);
    try {
      guard.canActivate(contextFor(user));
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toMatchObject({
        statusCode: 403,
        code: ErrorCode.FORBIDDEN,
      });
      expect((error as HttpException).getResponse()).toMatchObject({ message });
    }
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
    metadata(false, ['collaborator', 'admin']);

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

  it('rejects rather than falls open when the request carries no principal', () => {
    metadata(false, ['admin']);

    forbidden(undefined, 'Select or create a space first');
  });

  describe('@RequireMenu', () => {
    it('lets an admin through whatever its menu says', () => {
      metadata(false, undefined, 'members');

      expect(
        guard.canActivate(
          contextFor(buildPrincipal({ role: 'admin', menuAccess: [] })),
        ),
      ).toBe(true);
    });

    it('lets a collaborator through when its menu has the key', () => {
      metadata(false, undefined, 'events');

      expect(
        guard.canActivate(
          contextFor({ ...member, menuAccess: ['home', 'events'] }),
        ),
      ).toBe(true);
    });

    it('rejects a collaborator whose menu lacks the key', () => {
      metadata(false, undefined, 'members');

      forbidden(
        { ...member, menuAccess: ['home'] },
        'You do not have access to this section',
      );
    });

    it('rejects rather than falls open when the request carries no principal', () => {
      metadata(false, undefined, 'home');

      forbidden(undefined, 'Select or create a space first');
    });
  });
});
