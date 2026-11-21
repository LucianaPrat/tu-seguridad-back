import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SpaceMemberRole } from '@prisma/client';
import { ErrorCode } from '../common/constants';
import type { MenuKey } from '../common/permissions';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_MENU_KEY } from '../decorators/require-menu.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { buildGuardException } from '../errors/guard-exception';
import { RequestWithUser } from './jwt-auth.guard';

/**
 * Global, so authorization is declared on the route rather than remembered at
 * every call site. A space has three roles: `admin` manages its DVR, members,
 * routing and destructive configuration, and passes every menu check;
 * `collaborator` and `guest` are limited by `@Roles` and by the `menuAccess`
 * their membership grants (`@RequireMenu`). A route with neither decorator is
 * open to any member, and tenant scoping stays the accessor's job either way.
 * Runs after `SpaceMemberGuard`, which is what puts the DB-fresh role on the
 * request.
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
    const requiredMenu = this.reflector.getAllAndOverride<MenuKey | undefined>(
      REQUIRE_MENU_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length && !requiredMenu) {
      return true;
    }

    // A route that needs a role or a menu is a space route, so a request with
    // no principal here is a session in no space (or a guard-order mistake).
    // Either way it must not fall open.
    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user) {
      throw buildGuardException(
        ErrorCode.FORBIDDEN,
        'Select or create a space first',
      );
    }

    if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
      throw buildGuardException(
        ErrorCode.FORBIDDEN,
        'This action requires a space administrator',
      );
    }

    if (
      requiredMenu &&
      user.role !== 'admin' &&
      !user.menuAccess.includes(requiredMenu)
    ) {
      throw buildGuardException(
        ErrorCode.FORBIDDEN,
        'You do not have access to this section',
      );
    }
    return true;
  }
}
