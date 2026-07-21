import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import CircuitBreaker from 'opossum';
import { firstValueFrom } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { withSpan } from '../../observability/tracing.helpers';
import { DetectPersonsResponse } from './detect-persons-response';

type CircuitState = 'open' | 'halfOpen' | 'closed';

@Injectable()
export class FaceAuthClientService {
  private readonly logger = new Logger(FaceAuthClientService.name);
  private readonly breaker: CircuitBreaker<
    [Buffer, string],
    DetectPersonsResponse
  >;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    const timeout = this.configService.get<number>(EnvNames.DETECT_TIMEOUT_MS);
    this.breaker = new CircuitBreaker(
      (image: Buffer, filename: string) => this.callUpstream(image, filename),
      {
        timeout,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
      },
    );
    this.breaker.on('open', () =>
      this.logger.warn('face-auth circuit opened — short-circuiting calls'),
    );
    this.breaker.on('halfOpen', () =>
      this.logger.warn('face-auth circuit half-open — probing upstream'),
    );
    this.breaker.on('close', () =>
      this.logger.log('face-auth circuit closed — upstream healthy'),
    );
  }

  /** Current circuit state (breaker is global — one shared upstream). */
  get circuitState(): CircuitState {
    if (this.breaker.opened) return 'open';
    if (this.breaker.halfOpen) return 'halfOpen';
    return 'closed';
  }

  detectPersons(
    image: Buffer,
    filename: string,
  ): Promise<Either<DetectPersonsResponse>> {
    return withSpan('face-auth.detect', { filename }, async () => {
      try {
        const data = await this.breaker.fire(image, filename);
        return buildData(data);
      } catch (error) {
        return this.mapError(error);
      }
    });
  }

  /** Raw upstream call; throws on failure so the breaker counts it. */
  private async callUpstream(
    image: Buffer,
    filename: string,
  ): Promise<DetectPersonsResponse> {
    const form = new FormData();
    form.append('file', image, filename);

    const apiUrl = this.configService.get<string>(EnvNames.FACE_AUTH_API_URL);
    const timeout = this.configService.get<number>(EnvNames.DETECT_TIMEOUT_MS);

    const response = await firstValueFrom(
      this.httpService.post<DetectPersonsResponse>(
        `${apiUrl}/api/v1/persons`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Fa-Domain': this.configService.get<string>(
              EnvNames.FACE_AUTH_DOMAIN,
            ),
            'Fa-Token': this.configService.get<string>(
              EnvNames.FACE_AUTH_TOKEN,
            ),
          },
          timeout,
        },
      ),
    );
    return response.data;
  }

  private mapError(error: unknown): Either<DetectPersonsResponse> {
    if (this.isCode(error, 'EOPENBREAKER')) {
      return buildError(ErrorCode.UPSTREAM_ERROR, 'face-auth circuit open');
    }

    if (this.isCode(error, 'ETIMEDOUT')) {
      return buildError(
        ErrorCode.UPSTREAM_TIMEOUT,
        'face-auth detect request timed out',
      );
    }

    if (!axios.isAxiosError(error)) {
      return buildError(
        ErrorCode.UPSTREAM_ERROR,
        'face-auth request failed unexpectedly',
      );
    }

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return buildError(
        ErrorCode.UPSTREAM_TIMEOUT,
        'face-auth detect request timed out',
      );
    }

    const status = error.response?.status;
    return buildError(
      ErrorCode.UPSTREAM_ERROR,
      `face-auth upstream error (status ${status ?? 'unknown'})`,
    );
  }

  private isCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === code
    );
  }
}
