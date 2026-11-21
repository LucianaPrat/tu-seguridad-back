import { SetMetadata } from '@nestjs/common';
import type { SpaceMemberRole } from '@prisma/client';

export const ROLES_KEY = 'requiredRoles';

/**
 * Declares the membership roles allowed on a route. Read by `RolesGuard`, which
 * runs globally — a route with no `@Roles` is open to any authenticated member
 * of the space, and tenant scoping is still the accessor's job.
 */
export const Roles = (...roles: SpaceMemberRole[]) =>
  SetMetadata(ROLES_KEY, roles);
