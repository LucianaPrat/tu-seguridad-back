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

/** Upstream answer to too many calls from this address. */
const TOO_MANY_REQUESTS = 429;

/**
 * How long detection is parked when a `429` arrives without a `Retry-After`.
 * The upstream is IP-throttled and, measured on 2026-09-02, holds a penalty
 * window of 15–45 s after a burst — but it documents neither the limit nor the
 * header, so this is deliberately short: a park that outlives the throttle
 * costs alerts, and the next `429` simply parks again.
 */
const DEFAULT_THROTTLE_MS = 5000;

@Injectable()
export class FaceAuthClientService {
  private readonly logger = new Logger(FaceAuthClientService.name);
  /**
   * The session token last handed out by `/auth/authorize`. Opaque — it carries
   * no readable expiry, so there is nothing to pre-empt: it is cached until the
   * upstream rejects it, and a rejection is what triggers the next exchange.
   */
  private sessionToken: string | null = null;
  /**
   * The exchange in flight, if one is. The poll runs cameras in parallel, so
   * without this every camera in a batch that finds the cache empty — cold
   * start, or a 403 that just cleared it — fires its own `/auth/authorize`.
   */
  private authorizing: Promise<string> | null = null;
  /**
   * Epoch millis until which the upstream said it will refuse us. Detection
   * short-circuits while it stands, which is the whole point: a throttled
   * upstream answers a burst with more `429`s, and every one of those would
   * otherwise be one camera's poll spent learning nothing.
   */
  private throttledUntil = 0;
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
        // A throttle is not an outage. Without this filter a burst of `429`s
        // trips the breaker and every camera's detection short-circuits for
        // `resetTimeout`, reported as an upstream failure — which is both wrong
        // and a much longer outage than the throttle itself. The park in
        // `detectPersons` is what backs off instead.
        errorFilter: (error: unknown) =>
          this.isStatus(error, TOO_MANY_REQUESTS),
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
      const parkedFor = this.throttledUntil - Date.now();
      if (parkedFor > 0) {
        return buildError(
          ErrorCode.UPSTREAM_THROTTLED,
          `face-auth detect throttled, retrying in ${Math.ceil(parkedFor / 1000)}s`,
        );
      }

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
  private authorizedToken(): Promise<string> {
    if (this.sessionToken) {
      return Promise.resolve(this.sessionToken);
    }

    // Single-flight. Cleared once settled, so a failed exchange is retried by
    // the next caller instead of being cached as a rejection.
    this.authorizing ??= this.exchangeToken().finally(() => {
      this.authorizing = null;
    });
    return this.authorizing;
  }

  private async exchangeToken(): Promise<string> {
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

    // Parked here rather than in a caller because every caller would have to
    // remember to: the client owns the session token and now owns the window
    // the upstream refuses us for.
    if (this.isStatus(error, TOO_MANY_REQUESTS)) {
      const backoffMs = retryAfterMs(error) ?? DEFAULT_THROTTLE_MS;
      this.throttledUntil = Date.now() + backoffMs;
      this.logger.warn(
        `face-auth throttled the detect call, parking it for ${Math.ceil(backoffMs / 1000)}s`,
      );
      return buildError(
        ErrorCode.UPSTREAM_THROTTLED,
        'face-auth detect was rate limited',
      );
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

/**
 * `Retry-After` in millis, or `null` when the upstream sent none it can be
 * read from. RFC 9110 allows both a delay in seconds and an HTTP date, and this
 * upstream documents neither, so both are accepted and anything else is treated
 * as absent rather than as zero.
 */
function retryAfterMs(error: unknown): number | null {
  const header = (error as { response?: { headers?: Record<string, unknown> } })
    .response?.headers?.['retry-after'];
  if (typeof header !== 'string' && typeof header !== 'number') {
    return null;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? seconds * 1000 : null;
  }

  const until = Date.parse(String(header));
  if (Number.isNaN(until)) {
    return null;
  }
  const delta = until - Date.now();
  return delta > 0 ? delta : null;
}
