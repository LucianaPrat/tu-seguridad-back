import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { EnvNames, ErrorCode } from '../common/constants';

const HEADER = 'x-metrics-token';

/**
 * Gates GET /metrics behind a static shared-secret header. When METRICS_TOKEN
 * is unset (dev), the endpoint is open; in production the token is required by
 * env validation, so this always enforces there.
 */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>(EnvNames.METRICS_TOKEN);
    if (!expected) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[HEADER];
    if (typeof provided !== 'string' || !this.safeEqual(provided, expected)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          code: ErrorCode.UNAUTHORIZED,
          message: 'Invalid or missing metrics token',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
