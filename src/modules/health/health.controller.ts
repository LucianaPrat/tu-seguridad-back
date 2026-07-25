import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../../cross/decorators/public.decorator';
import { FaceAuthHealthIndicator } from './face-auth.health-indicator';
import { PrismaHealthIndicator } from './prisma.health-indicator';

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealthIndicator: PrismaHealthIndicator,
    private readonly faceAuthHealthIndicator: FaceAuthHealthIndicator,
  ) {}

  @Public()
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaHealthIndicator.pingCheck('db'),
    ]);
  }

  // Separate from /ready on purpose: a degraded face-auth upstream must not make
  // the whole app report not-ready — camera/zone CRUD still works without it.
  @Public()
  @Get('dependencies')
  @HealthCheck()
  dependencies() {
    return this.health.check([
      () => this.faceAuthHealthIndicator.isHealthy('face-auth'),
    ]);
  }
}
