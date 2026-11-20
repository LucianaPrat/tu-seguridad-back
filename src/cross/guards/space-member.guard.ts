import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../common/constants';
import { isMenuKey } from '../common/permissions';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { ALLOW_NO_SPACE_KEY } from '../decorators/allow-no-space.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { buildGuardException } from '../errors/guard-exception';
import { RequestWithUser } from './jwt-auth.guard';

/**
 * Turns the token's claims into the request principal by reading the caller's
 * membership from the database on every request. The token only says which
 * space the session is in; whether the caller still belongs there, and with
 * which role and permissions, is never trusted from it — so a role change or a
 * removal applies on the next request instead of when the token expires.
 */
@Injectable()
export class SpaceMemberGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly spaceMemberAccessor: SpaceMemberAccessorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const claims = request.claims;
    if (!claims) {
      throw buildGuardException(ErrorCode.UNAUTHORIZED, 'Missing bearer token');
    }

    if (claims.spaceId === null) {
      const allowsNoSpace = this.reflector.getAllAndOverride<boolean>(
        ALLOW_NO_SPACE_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (allowsNoSpace) {
        return true;
      }
      throw buildGuardException(
        ErrorCode.FORBIDDEN,
        'Select or create a space first',
      );
    }

    const member = await this.spaceMemberAccessor.findBySpaceAndUser(
      claims.spaceId,
      claims.sub,
    );
    if (!member) {
      throw buildGuardException(
        ErrorCode.FORBIDDEN,
        'You are no longer a member of this space',
      );
    }

    // The columns are Json: anything that is not a known key or a string id is
    // dropped rather than trusted.
    const menuAccess = Array.isArray(member.menuAccess)
      ? member.menuAccess.filter(isMenuKey)
      : [];
    const cameraIds = Array.isArray(member.cameraIds)
      ? member.cameraIds.filter((id): id is string => typeof id === 'string')
      : [];
    request.user = {
      ...claims,
      spaceId: claims.spaceId,
      role: member.role,
      menuAccess,
      cameraIds,
      receiveAlerts: member.receiveAlerts,
    };
    return true;
  }
}
