import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { SessionContext } from '../common/session-context.type';

/**
 * Keeps `req.headers`/`req.ip` out of the services that issue sessions: they take
 * a `SessionContext`, not an Express request.
 */
export const RequestSessionContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return { userAgent: request.headers['user-agent'], ip: request.ip };
  },
);
