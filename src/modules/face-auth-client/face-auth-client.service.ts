import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import FormData from 'form-data';
import CircuitBreaker from 'opossum';
import { firstValueFrom } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { mapUpstreamError } from '../../cross/errors/upstream-error';
import { withSpan } from '../../observability/tracing.helpers';
import {
  DetectPersonsResponse,
  isDetectPersonsResponse,
} from './detect-persons-response';

type CircuitState = 'open' | 'halfOpen' | 'closed';

interface AuthorizeResponse {
  isAuth: boolean;
  token: string;
}

/** Upstream answer to a session token it no longer accepts. */
const FORBIDDEN = 403;

@Injectable()
export class FaceAuthClientService {
  private readonly logger = new Logger(FaceAuthClientService.name);
  /**
   * The session token last handed out by `/auth/authorize`. Opaque — it carries
   * no readable expiry, so there is nothing to pre-empt: it is cached until the
   * upstream rejects it, and a rejection is what triggers the next exchange.
   */
  private sessionToken: string | null = null;
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

  /**
   * Raw upstream call; throws on failure so the breaker counts it.
   *
   * The detection endpoints do not accept the tenant's client token. That one
   * buys a session token at `/auth/authorize`, and only the session token is
   * sent as `Fa-Token` — presenting the client token directly answers `403` on
   * every call, which would read as an upstream outage and open the circuit.
   */
  private async callUpstream(
    image: Buffer,
    filename: string,
  ): Promise<DetectPersonsResponse> {
    try {
      return await this.detect(image, filename, await this.authorizedToken());
    } catch (error) {
      if (!this.isStatus(error, FORBIDDEN)) {
        throw error;
      }
      // The cached token stopped being accepted. One re-exchange, then the
      // failure is real: retrying past that would turn a revoked client token
      // into an authorize loop against a upstream that is already saying no.
      this.logger.warn('face-auth session token rejected — re-authorizing');
      this.sessionToken = null;
      return this.detect(image, filename, await this.authorizedToken());
    }
  }

  private async detect(
    image: Buffer,
    filename: string,
    sessionToken: string,
  ): Promise<DetectPersonsResponse> {
    const form = new FormData();
    form.append('file', image, filename);

    const response = await firstValueFrom(
      this.httpService.post<unknown>(`${this.apiUrl()}/api/v1/persons`, form, {
        headers: {
          ...form.getHeaders(),
          'Fa-Domain': this.domain(),
          'Fa-Token': sessionToken,
        },
        timeout: this.timeout(),
      }),
    );

    if (!isDetectPersonsResponse(response.data)) {
      throw new Error('face-auth detect answered a body it cannot read');
    }
    return response.data;
  }

  /** The cached session token, exchanging the client token for one if needed. */
  private async authorizedToken(): Promise<string> {
    if (this.sessionToken) {
      return this.sessionToken;
    }

    const response = await firstValueFrom(
      this.httpService.post<AuthorizeResponse>(
        `${this.apiUrl()}/api/v1/auth/authorize`,
        undefined,
        {
          headers: {
            'Fa-Domain': this.domain(),
            'Fa-Client-Token': this.configService.get<string>(
              EnvNames.FACE_AUTH_CLIENT_TOKEN,
            ),
          },
          timeout: this.timeout(),
        },
      ),
    );

    // A body without a token is not a usable session, and caching the empty
    // string would send an empty `Fa-Token` on every later call.
    if (!response.data?.isAuth || !response.data.token) {
      throw new Error('face-auth authorize returned no session token');
    }
    this.sessionToken = response.data.token;
    return this.sessionToken;
  }

  private apiUrl(): string | undefined {
    return this.configService.get<string>(EnvNames.FACE_AUTH_API_URL);
  }

  private domain(): string | undefined {
    return this.configService.get<string>(EnvNames.FACE_AUTH_DOMAIN);
  }

  private timeout(): number | undefined {
    return this.configService.get<number>(EnvNames.DETECT_TIMEOUT_MS);
  }

  private isStatus(error: unknown, status: number): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { response?: { status?: number } }).response?.status === status
    );
  }

  private mapError(error: unknown): Either<DetectPersonsResponse> {
    if (this.isCode(error, 'EOPENBREAKER')) {
      return buildError(ErrorCode.UPSTREAM_ERROR, 'face-auth circuit open');
    }

    // The circuit breaker's own timeout is not an axios error, so the shared
    // mapper never sees it.
    if (this.isCode(error, 'ETIMEDOUT')) {
      return buildError(
        ErrorCode.UPSTREAM_TIMEOUT,
        'face-auth detect request timed out',
      );
    }

    return mapUpstreamError(error, 'face-auth detect');
  }

  private isCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === code
    );
  }
}
