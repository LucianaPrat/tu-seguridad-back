import { ExecutionContext, HttpException } from '@nestjs/common';
import { CAMERA_FORBIDDEN_MESSAGE } from '../common/permissions';
import { buildPrincipal } from '../common/jwt-payload.fixture';
import type { JwtPayload } from '../common/jwt-payload.type';
import { CameraAccessGuard } from './camera-access.guard';
import { RequestWithUser } from './jwt-auth.guard';

describe('CameraAccessGuard', () => {
  const guard = new CameraAccessGuard();
  const guest = buildPrincipal({ role: 'guest', cameraIds: ['cam-1'] });
  const admin = buildPrincipal({ role: 'admin' });

  function contextFor(
    user: JwtPayload | undefined,
    params: Record<string, string>,
  ): ExecutionContext {
    const request: Partial<RequestWithUser> = { user, params };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function expectForbidden(context: ExecutionContext): void {
    expect.assertions(2);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(403);
      expect((error as HttpException).getResponse()).toMatchObject({
        message: CAMERA_FORBIDDEN_MESSAGE,
      });
    }
  }

  it('passes an admin', () => {
    expect(guard.canActivate(contextFor(admin, { id: 'cam-9' }))).toBe(true);
  });

  it('passes a guest on a camera in its scope', () => {
    expect(guard.canActivate(contextFor(guest, { id: 'cam-1' }))).toBe(true);
  });

  it('refuses a guest on a camera out of its scope', () => {
    expectForbidden(contextFor(guest, { id: 'cam-2' }));
  });

  it('prefers cameraId over id', () => {
    expect(
      guard.canActivate(contextFor(guest, { cameraId: 'cam-1', id: 'zone-9' })),
    ).toBe(true);
  });

  it('fails closed without a user', () => {
    expectForbidden(contextFor(undefined, { id: 'cam-1' }));
  });
});
