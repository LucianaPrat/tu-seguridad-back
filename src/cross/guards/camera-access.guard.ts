import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ErrorCode } from '../common/constants';
import { CAMERA_FORBIDDEN_MESSAGE, canSeeCamera } from '../common/permissions';
import { buildGuardException } from '../errors/guard-exception';
import { RequestWithUser } from './jwt-auth.guard';

/**
 * Route-level, only on routes whose path names a camera (`:cameraId`, or `:id`
 * under `/cameras`). A guest reaches only the cameras its membership lists;
 * every other role passes. Runs after the global guards, so the DB-fresh
 * principal is already on the request; a missing one fails closed.
 */
@Injectable()
export class CameraAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const params = request.params as Record<string, string | undefined>;
    const cameraId = params.cameraId ?? params.id ?? null;
    if (!request.user || !canSeeCamera(request.user, cameraId)) {
      throw buildGuardException(ErrorCode.FORBIDDEN, CAMERA_FORBIDDEN_MESSAGE);
    }
    return true;
  }
}
