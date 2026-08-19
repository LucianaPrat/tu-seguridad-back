import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../../cross/decorators/public.decorator';
import { FaceAuthHealthIndicator } from './face-auth.health-indicator';
import { PrismaHealthIndicator } from './prisma.health-indicator';

// Terminus answers `{ status, info, error, details }` and is version-neutral, so
// these three sit outside the `/api/v1` prefix. Shape is Terminus', not ours.
const TERMINUS_OK =
  'Terminus report: `{ status: "ok", info, error, details }`.';
const TERMINUS_DOWN =
  'At least one indicator is down. Same Terminus report with `status: "error"`.';

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
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Public. Answers as long as the process is up and accepting requests. Runs no ' +
      'indicator, so it never fails for a dependency — restart the process when this ' +
      'stops answering.',
  })
  @ApiOkResponse({ description: `Process is up. ${TERMINUS_OK}` })
  live() {
    return this.health.check([]);
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Public. Pings the database. Answers whether this instance can serve traffic — ' +
      'the check a load balancer should route on.',
  })
  @ApiOkResponse({ description: `Database reachable. ${TERMINUS_OK}` })
  @ApiResponse({ status: 503, description: TERMINUS_DOWN })
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
  @ApiOperation({
    summary: 'Upstream reachability',
    description:
      'Public. Short-timeout reachability check against the face-auth detection API. ' +
      'Deliberately separate from `/health/ready`: a degraded upstream is reported ' +
      'here without marking the instance not-ready, because camera and zone ' +
      'management keep working without it. Only person detection stops.',
  })
  @ApiOkResponse({ description: `Upstream reachable. ${TERMINUS_OK}` })
  @ApiResponse({ status: 503, description: TERMINUS_DOWN })
  dependencies() {
    return this.health.check([
      () => this.faceAuthHealthIndicator.isHealthy('face-auth'),
    ]);
  }
}
