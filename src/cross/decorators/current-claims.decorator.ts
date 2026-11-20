import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AccessTokenClaims } from '../common/jwt-payload.type';
import { RequestWithUser } from '../guards/jwt-auth.guard';

/** The token's claims, for routes that run with or without a space. */
export const CurrentClaims = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenClaims | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.claims;
  },
);
