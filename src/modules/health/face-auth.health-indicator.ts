import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { firstValueFrom } from 'rxjs';
import { EnvNames } from '../../cross/common/constants';

const REACHABILITY_TIMEOUT_MS = 2000;

@Injectable()
export class FaceAuthHealthIndicator {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy<Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const check = this.healthIndicatorService.check(key);
    const url = this.config.get<string>(EnvNames.FACE_AUTH_API_URL);
    try {
      // Any HTTP response means the upstream is reachable — a 401/404 is still
      // "up" for reachability purposes. Only transport errors/timeouts are down.
      await firstValueFrom(
        this.http.get(url ?? '', {
          timeout: REACHABILITY_TIMEOUT_MS,
          validateStatus: () => true,
        }),
      );
      return check.up();
    } catch (error) {
      return check.down({
        message: error instanceof Error ? error.message : 'unreachable',
      });
    }
  }
}
