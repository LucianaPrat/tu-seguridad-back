import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../common/jwt-payload.type';
import { RequestWithUser } from '../guards/jwt-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
