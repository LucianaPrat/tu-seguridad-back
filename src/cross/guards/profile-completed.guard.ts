import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../common/constants';
import { ALLOW_INCOMPLETE_PROFILE_KEY } from '../decorators/allow-incomplete-profile.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { buildGuardException } from '../errors/guard-exception';
import { RequestWithUser } from './jwt-auth.guard';

/**
 * An invited user is logged in before it has a name, a phone or a password of
 * its own. That session must reach profile completion and nothing else, which is
 * a global default here rather than a check each new controller has to remember:
 * the route someone forgets to gate is the one that leaks a half-built account
 * into the product.
 */
@Injectable()
export class ProfileCompletedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const allowsIncompleteProfile = this.reflector.getAllAndOverride<boolean>(
      ALLOW_INCOMPLETE_PROFILE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowsIncompleteProfile) {
      return true;
    }

    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user) {
      throw buildGuardException(ErrorCode.UNAUTHORIZED, 'Missing bearer token');
    }

    if (!user.profileCompleted) {
      throw buildGuardException(
        ErrorCode.FORBIDDEN,
        'Complete your profile before using this resource',
      );
    }
    return true;
  }
}
