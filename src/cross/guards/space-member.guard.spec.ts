import { ExecutionContext, HttpException } from '@nestjs/common';
import { ErrorCode } from '../common/constants';
import type { AccessTokenClaims } from '../common/jwt-payload.type';
import { RequestWithUser } from './jwt-auth.guard';
import { SpaceMemberGuard } from './space-member.guard';

describe('SpaceMemberGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let spaceMemberAccessor: { findBySpaceAndUser: jest.Mock };
  let guard: SpaceMemberGuard;

  const claims: AccessTokenClaims = {
    sub: 5,
    email: 'member@example.com',
    spaceId: 'space-1',
    profileCompleted: true,
  };

  function contextFor(request: Partial<RequestWithUser>): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  /** `getAllAndOverride` is called for the public flag first, then for the no-space allowance. */
  function metadata(isPublic: boolean, allowsNoSpace?: boolean): void {
    reflector.getAllAndOverride
      .mockReturnValueOnce(isPublic)
      .mockReturnValueOnce(allowsNoSpace);
  }

  async function rejection(
    request: Partial<RequestWithUser>,
  ): Promise<HttpException> {
    try {
      await guard.canActivate(contextFor(request));
    } catch (error) {
      return error as HttpException;
    }
    throw new Error('Expected the guard to reject');
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    spaceMemberAccessor = { findBySpaceAndUser: jest.fn() };
    guard = new SpaceMemberGuard(
      reflector as never,
      spaceMemberAccessor as never,
    );
  });

  it('skips a public route', async () => {
    metadata(true);

    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    expect(spaceMemberAccessor.findBySpaceAndUser).not.toHaveBeenCalled();
  });

  it('answers UNAUTHORIZED when no claims reached the request', async () => {
    metadata(false);

    expect((await rejection({})).getResponse()).toMatchObject({
      statusCode: 401,
      code: ErrorCode.UNAUTHORIZED,
    });
  });

  it('lets a session in no space onto a route that allows it', async () => {
    metadata(false, true);
    const request: Partial<RequestWithUser> = {
      claims: { ...claims, spaceId: null },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(spaceMemberAccessor.findBySpaceAndUser).not.toHaveBeenCalled();
  });

  it('rejects a session in no space everywhere else with FORBIDDEN', async () => {
    metadata(false, false);

    const error = await rejection({ claims: { ...claims, spaceId: null } });

    expect(error.getResponse()).toMatchObject({
      statusCode: 403,
      code: ErrorCode.FORBIDDEN,
      message: 'Select or create a space first',
    });
  });

  it('rejects a caller who is no longer a member of the token space', async () => {
    metadata(false, false);
    spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue(null);

    const error = await rejection({ claims });

    expect(spaceMemberAccessor.findBySpaceAndUser).toHaveBeenCalledWith(
      'space-1',
      5,
    );
    expect(error.getResponse()).toMatchObject({
      statusCode: 403,
      code: ErrorCode.FORBIDDEN,
      message: 'You are no longer a member of this space',
    });
  });

  it('builds the principal from the membership row, not from the token', async () => {
    metadata(false, false);
    spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue({
      role: 'collaborator',
      // Json columns: unknown keys and non-string ids must not survive.
      menuAccess: ['home', 'events', 'bogus', 7],
      cameraIds: ['cam-1', 42, null],
      receiveAlerts: false,
    });
    const request: Partial<RequestWithUser> = { claims };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(request.user).toEqual({
      ...claims,
      spaceId: 'space-1',
      role: 'collaborator',
      menuAccess: ['home', 'events'],
      cameraIds: ['cam-1'],
      receiveAlerts: false,
    });
  });

  it('treats a malformed Json column as empty', async () => {
    metadata(false, false);
    spaceMemberAccessor.findBySpaceAndUser.mockResolvedValue({
      role: 'guest',
      menuAccess: null,
      cameraIds: { not: 'an array' },
      receiveAlerts: true,
    });
    const request: Partial<RequestWithUser> = { claims };

    await guard.canActivate(contextFor(request));

    expect(request.user).toMatchObject({ menuAccess: [], cameraIds: [] });
  });
});
