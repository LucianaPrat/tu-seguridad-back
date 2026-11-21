import {
  Controller,
  Get,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import type { Response } from 'express';
import { Public } from '../decorators/public.decorator';
import { MetricsTokenGuard } from './metrics-token.guard';

// Extends the library controller only to attach @Public() (bypass the global
// JWT guard) and the shared-secret guard. The library overwrites the path
// metadata to '/metrics'; VERSION_NEUTRAL + the 'metrics' global-prefix exclude
// in main.ts keep the final route at a bare /metrics (like the health routes).
@Controller({ version: VERSION_NEUTRAL })
@Public()
@UseGuards(MetricsTokenGuard)
export class MetricsController extends PrometheusController {
  @Get()
  async index(@Res({ passthrough: true }) response: Response): Promise<string> {
    return super.index(response);
  }
}
