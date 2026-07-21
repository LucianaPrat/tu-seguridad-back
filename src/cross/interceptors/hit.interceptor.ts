import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { HitAccessorService } from '../../data/accessors/hit.accessor';
import { RequestWithUser } from '../guards/jwt-auth.guard';

const SKIPPED_PATH_PREFIXES = ['/health', '/docs'];

@Injectable()
export class HitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HitInterceptor.name);

  constructor(private readonly hitAccessor: HitAccessorService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (this.shouldSkip(request.path)) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();
    const method = request.method;
    const route = request.path;
    const userId = request.user?.sub;

    response.once('finish', () => {
      const statusCode = response.statusCode;
      this.hitAccessor
        .create({
          method,
          route,
          statusCode,
          durationMs: Date.now() - startedAt,
          userId,
          isError: statusCode >= 400,
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `failed to persist hit for ${method} ${route}`,
            error,
          );
        });
    });

    return next.handle();
  }

  private shouldSkip(path: string): boolean {
    return SKIPPED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
  }
}
