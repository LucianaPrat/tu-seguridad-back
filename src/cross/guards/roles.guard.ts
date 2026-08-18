import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SpaceMemberRole } from '@prisma/client';
import { ErrorCode } from '../common/constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { buildGuardException } from '../errors/guard-exception';
import { RequestWithUser } from './jwt-auth.guard';

/**
 * Global, so authorization is declared on the route rather than remembered at
 * every call site. Only administrators of a space manage its DVR, members,
 * routing and destructive configuration; a route without `@Roles` is readable by
 * any member, and tenant scoping stays the accessor's job either way.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<SpaceMemberRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) {
      return true;
    }

    // Defensive rather than decorative: global guard order is registration
    // order, and this guard must not fall open if it ever runs before the
    // authentication guard has populated the request.
    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user) {
      throw buildGuardException(ErrorCode.UNAUTHORIZED, 'Missing bearer token');
    }

    if (!requiredRoles.includes(user.role)) {
      throw buildGuardException(
        ErrorCode.FORBIDDEN,
        'This action requires a space administrator',
      );
    }
    return true;
  }
}
