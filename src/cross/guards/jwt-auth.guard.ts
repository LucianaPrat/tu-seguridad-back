import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { EnvNames, ErrorCode } from '../common/constants';
import { JwtPayload, RefreshJwtPayload } from '../common/jwt-payload.type';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export interface RequestWithUser extends Request {
  user?: JwtPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request);
    if (!token) {
      throw this.unauthorized('Missing bearer token');
    }

    let payload: JwtPayload & Partial<RefreshJwtPayload>;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>(EnvNames.JWT_SECRET),
      });
    } catch {
      throw this.unauthorized('Invalid or expired token');
    }

    if (payload.type === 'refresh') {
      throw this.unauthorized(
        'Refresh token cannot be used to access this resource',
      );
    }

    request.user = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) {
      return undefined;
    }
    const [scheme, token] = header.split(' ');
    return scheme === 'Bearer' ? token : undefined;
  }

  private unauthorized(message: string): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.UNAUTHORIZED,
        code: ErrorCode.UNAUTHORIZED,
        message,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
