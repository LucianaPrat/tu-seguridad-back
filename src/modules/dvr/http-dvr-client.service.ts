import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { CameraStatus } from '@prisma/client';
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { firstValueFrom } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { MetricNames } from '../../cross/metrics/metric-names';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { mapUpstreamError } from '../../cross/errors/upstream-error';
import {
  CapturedImage,
  DiscoveredChannel,
  DvrClientPort,
  DvrConnection,
} from './dvr-client.port';

/**
 * Hikvision ISAPI, verified against a DVR-208G-M1 on firmware V4.71.410.
 *
 * Two id schemes live in this API and mixing them is the easy mistake:
 * `/System/Video/inputs/channels` speaks the BNC port number (1..8), while
 * `/Streaming/channels` wants port and stream glued together — `401` is port
 * 4, main stream, `402` its substream. `externalId` stores the port, because
 * the port is the physical thing an operator can point at on the back of the
 * box; which stream we pull a frame from is our decision, not theirs.
 */
const CHANNELS_PATH = '/ISAPI/System/Video/inputs/channels';
const MAIN_STREAM = '01';
const SUB_STREAM = '02';
const snapshotPath = (port: string) =>
  `/ISAPI/Streaming/channels/${port}${MAIN_STREAM}/picture?snapShotImageType=JPEG`;

/**
 * RTSP takes the same two-part channel id as the snapshot path, but not the
 * `/ISAPI` prefix and not the base URL's port: it is a separate service. A base
 * URL carrying its own path prefix is therefore irrelevant here, unlike on the
 * signed HTTP request line.
 */
const rtspPath = (port: string, stream: string) =>
  `/Streaming/Channels/${port}${stream}`;

/** A BNC port number, and the only shape allowed to reach a request path. */
const CHANNEL_PORT = /^\d{1,2}$/;

/**
 * `videoInputEnabled` reads `true` on all eight ports whether a camera is
 * wired to them or not, so `resDesc` is the only field that separates a live
 * camera from an empty socket. An empty socket still answers the snapshot
 * endpoint with HTTP 200 and a "NO VIDEO" placeholder JPEG, so this listing —
 * not the snapshot status code — is what decides whether a channel is online.
 */
const NO_SIGNAL = 'NO VIDEO';

const CHANNEL_BLOCK = /<VideoInputChannel[\s>][\s\S]*?<\/VideoInputChannel>/g;

/**
 * The real listing is a couple of kilobytes for eight ports. The cap is here so
 * a recorder that answers the discovery probe with a stream instead of a
 * document cannot be buffered without bound; snapshots have their own, tunable,
 * limit because their size is a product decision rather than a sanity check.
 */
const MAX_LISTING_BYTES = 1_000_000;

/** A recorder's outstanding digest challenge and the nonce count spent on it. */
interface Challenge {
  header: string;
  count: number;
}

/** Marks the one failure axios cannot describe on its own: no usable challenge. */
const DIGEST_UNSUPPORTED = 'EDVRDIGEST';
const DIGEST_HASHES: Record<string, string> = {
  MD5: 'md5',
  'SHA-256': 'sha256',
};
/**
 * `nc` in the RFC 7616 sense: eight hex digits, strictly increasing for as long
 * as one nonce is reused. It only moves because the challenge is cached now —
 * a fresh challenge per request would leave it at one forever.
 */
const nonceCount = (count: number) => count.toString(16).padStart(8, '0');

/**
 * Failures worth a second attempt: the connection died, or nothing came back in
 * time. Deliberately no status codes — a recorder that answered `401`, `404` or
 * `500` gave an answer, and asking it the same question again gets the same
 * one while the camera waits out another cadence interval for nothing.
 */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
]);

/** Short and linear. The next poll is the real backoff; this covers a blip. */
const RETRY_BACKOFF_MS = 250;

const isTransient = (error: unknown): boolean =>
  axios.isAxiosError(error) &&
  error.response === undefined &&
  TRANSIENT_CODES.has(error.code ?? '');

@Injectable()
export class HttpDvrClientService extends DvrClientPort {
  /**
   * The last digest challenge each recorder handed out, and how many requests
   * have been signed with it. One entry per recorder — a space has exactly one
   * — so nothing evicts them.
   */
  private readonly challenges = new Map<string, Challenge>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectMetric(MetricNames.DVR_CAPTURE_TOTAL)
    private readonly captureTotal: Counter<string>,
    @InjectMetric(MetricNames.DVR_CAPTURE_RETRY_TOTAL)
    private readonly captureRetries: Counter<string>,
  ) {
    super();
  }

  async discoverChannels(
    connection: DvrConnection,
  ): Promise<Either<DiscoveredChannel[]>> {
    try {
      const response = await this.get<string>(connection, CHANNELS_PATH, {
        responseType: 'text',
        timeout: this.configService.get<number>(EnvNames.DVR_TIMEOUT_MS),
        maxContentLength: MAX_LISTING_BYTES,
      });

      const channels = parseChannels(response.data);
      // A recorder with zero video inputs does not exist, so an empty roster
      // means the body was not the listing we asked for. Calling that a
      // success would hand `reconcileDiscovery` an empty set and unconfigure
      // every camera in the space over a bad response.
      if (channels.length === 0) {
        return buildError(
          ErrorCode.UPSTREAM_ERROR,
          'DVR channel listing could not be read',
        );
      }
      return buildData(channels);
    } catch (error) {
      return this.mapError(error, 'DVR channel discovery');
    }
  }

  async captureSnapshot(
    connection: DvrConnection,
    externalId: string,
  ): Promise<Either<CapturedImage>> {
    if (!CHANNEL_PORT.test(externalId)) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        'DVR channel is not a video input number',
      );
    }

    const maxBytes = this.maxSnapshotBytes();

    try {
      const response = await this.captureWithRetries(
        connection,
        externalId,
        maxBytes,
      );

      const mimeType = (response.headers['content-type'] as string | undefined)
        ?.split(';')[0]
        ?.trim();
      if (!mimeType?.startsWith('image/')) {
        return buildError(
          ErrorCode.UPSTREAM_ERROR,
          'DVR snapshot response was not an image',
        );
      }

      const data = Buffer.from(response.data);
      if (data.byteLength > maxBytes) {
        return buildError(
          ErrorCode.UPSTREAM_ERROR,
          `DVR snapshot is larger than the ${maxBytes} byte limit`,
        );
      }

      this.captureTotal.inc({ channel: externalId, outcome: 'success' });
      return buildData({
        data,
        mimeType,
        byteSize: data.byteLength,
        sha256: createHash('sha256').update(data).digest('hex'),
        capturedAt: new Date(),
      });
    } catch (error) {
      this.captureTotal.inc({ channel: externalId, outcome: 'error' });
      return this.mapError(error, 'DVR snapshot fetch');
    }
  }

  /**
   * One capture, with a bounded second chance at the failures that say nothing
   * about the recorder's answer.
   *
   * Without it a single dropped connection costs the camera a whole cadence
   * interval, which at the passive rung is fifteen seconds of nothing for a
   * recorder that was fine. With it, only the transient classes are retried: a
   * `401`, a `404` or a `500` is an answer, and asking again gets the same one.
   */
  private async captureWithRetries(
    connection: DvrConnection,
    externalId: string,
    maxBytes: number,
  ): Promise<AxiosResponse<ArrayBuffer>> {
    const retries = this.configService.getOrThrow<number>(
      EnvNames.DVR_CAPTURE_RETRIES,
    );
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.get<ArrayBuffer>(
          connection,
          snapshotPath(externalId),
          {
            responseType: 'arraybuffer',
            timeout: this.configService.get<number>(
              EnvNames.SNAPSHOT_TIMEOUT_MS,
            ),
            // Aborts the transfer mid-stream instead of buffering an
            // oversized image just to reject it after the fact.
            maxContentLength: maxBytes,
          },
        );
      } catch (error) {
        if (attempt >= retries || !isTransient(error)) {
          throw error;
        }
        this.captureRetries.inc({ channel: externalId });
        await delay(RETRY_BACKOFF_MS * (attempt + 1));
      }
    }
  }

  streamUrl(connection: DvrConnection, externalId: string): Either<string> {
    if (!CHANNEL_PORT.test(externalId)) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        'DVR channel is not a video input number',
      );
    }

    let host: string;
    try {
      // `hostname` keeps the brackets an IPv6 literal needs in front of `:port`,
      // and drops the base URL's own port, which is the HTTP one.
      host = new URL(connection.url).hostname;
    } catch {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        'DVR base URL cannot be parsed',
      );
    }

    const port = this.configService.get<number>(EnvNames.DVR_RTSP_PORT);
    const stream =
      this.configService.get<string>(EnvNames.DVR_RTSP_STREAM) === 'main'
        ? MAIN_STREAM
        : SUB_STREAM;
    // Encoded rather than interpolated raw: a password holding `@`, `:` or `/`
    // would otherwise move the host or the path.
    const user = encodeURIComponent(connection.username);
    const secret = encodeURIComponent(connection.password);

    return buildData(
      `rtsp://${user}:${secret}@${host}:${port}${rtspPath(externalId, stream)}`,
    );
  }

  /**
   * ISAPI answers only to HTTP digest. The challenge is cached per recorder, so
   * the usual call is one signed request rather than the 401 handshake plus the
   * signed retry — at one poll per camera per cadence interval, that second
   * round trip was doubling the request count against the slowest thing in the
   * loop.
   *
   * The state it costs is one header and one counter per recorder. A nonce the
   * recorder has expired, or a recorder that restarted, answers `401` to the
   * signed request; that drops the entry and falls through to a fresh
   * challenge, so the stale case costs what every case used to.
   */
  private async get<T>(
    connection: DvrConnection,
    path: string,
    overrides: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const url = this.endpoint(connection, path);
    const key = challengeKey(connection);
    const target = requestTarget(url);

    const cached = this.challenges.get(key);
    if (cached) {
      cached.count += 1;
      const authorization = buildAuthorization(
        cached.header,
        connection,
        target,
        cached.count,
      );
      if (authorization) {
        const signed = await firstValueFrom(
          this.httpService.get<T>(url, {
            ...overrides,
            headers: { ...overrides.headers, Authorization: authorization },
            validateStatus: (status) =>
              status === 401 || (status >= 200 && status < 300),
          }),
        );
        if (signed.status !== 401) {
          return signed;
        }
      }
      // Expired nonce, restarted recorder, or a challenge this build cannot
      // sign any more. Either way the cached one is worthless.
      this.challenges.delete(key);
    }

    const challenge = await firstValueFrom(
      this.httpService.get<T>(url, {
        ...overrides,
        validateStatus: (status) =>
          status === 401 || (status >= 200 && status < 300),
      }),
    );
    if (challenge.status !== 401) {
      return challenge;
    }

    const header = challenge.headers['www-authenticate'] as string | undefined;
    const authorization = buildAuthorization(header, connection, target, 1);
    // Nothing to sign means the password can never be presented at all, which
    // is a different problem from a password the recorder looked at and
    // refused. Saying so beats reporting a credential rejection that did not
    // happen and sending the operator to re-type a password that was fine.
    if (!authorization) {
      throw new AxiosError('no supported digest challenge', DIGEST_UNSUPPORTED);
    }
    if (header) {
      this.challenges.set(key, { header, count: 1 });
    }

    return firstValueFrom(
      this.httpService.get<T>(url, {
        ...overrides,
        headers: { ...overrides.headers, Authorization: authorization },
      }),
    );
  }

  private maxSnapshotBytes(): number {
    return this.configService.getOrThrow<number>(EnvNames.SNAPSHOT_MAX_BYTES);
  }

  /** LAN recorders are the normal case, so the base URL is joined, never parsed. */
  private endpoint(connection: DvrConnection, path: string): string {
    return `${connection.url.replace(/\/+$/, '')}${path}`;
  }

  private mapError<T>(error: unknown, operation: string): Either<T> {
    if (axios.isAxiosError(error)) {
      if (error.code === DIGEST_UNSUPPORTED) {
        return buildError(
          ErrorCode.UPSTREAM_ERROR,
          `${operation} failed: DVR offered no supported authentication scheme`,
        );
      }

      const status = error.response?.status;
      // A recorder that answers 401/403 to the signed request is reachable: what
      // is wrong is the configuration the operator just submitted, so this is
      // their 400, not a 502 about somebody else's outage.
      if (status === 401 || status === 403) {
        return buildError(
          ErrorCode.VALIDATION_ERROR,
          'DVR rejected the supplied credentials',
        );
      }
    }

    return mapUpstreamError(error, operation);
  }
}

/**
 * Three fields out of one fixed vendor schema, so a regex sweep stands in for
 * an XML parser dependency — this listing is the only XML the client reads,
 * and a parser that touches untrusted input would owe a security review for
 * less code than it replaces.
 *
 * ponytail: swap in a real parser the day a second ISAPI document is needed.
 */
function parseChannels(xml: string): DiscoveredChannel[] {
  return [...xml.matchAll(CHANNEL_BLOCK)].flatMap(([block]) => {
    const externalId = tagText(block, 'id');
    if (!externalId || !CHANNEL_PORT.test(externalId)) {
      return [];
    }
    // An absent `resDesc` reads as an empty socket rather than a live camera:
    // an unrecognised listing must not promote channels to online.
    const resolution = tagText(block, 'resDesc') ?? NO_SIGNAL;
    return [
      {
        externalId,
        name: tagText(block, 'name') || `Camera ${externalId}`,
        location: null,
        status:
          resolution.toUpperCase() === NO_SIGNAL
            ? CameraStatus.offline
            : CameraStatus.online,
      },
    ];
  });
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/** Channel names are operator-editable, so the five XML entities are undone. */
function tagText(block: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([^<]*)</${tag}>`)
    .exec(block)?.[1]
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity])
    .trim();
}

/**
 * RFC 7616 digest, the only scheme ISAPI accepts. `-sess` algorithms and
 * `auth-int` are left out on purpose: no firmware in reach offers them, and
 * guessing at a variant nothing can verify turns a loud auth failure into a
 * quiet one. An unknown challenge returns undefined and is reported as such.
 */
function buildAuthorization(
  header: string | undefined,
  connection: DvrConnection,
  uri: string,
  count: number,
): string | undefined {
  const digest = /(?:^|,)\s*Digest\s+(.*)$/i.exec(header ?? '');
  if (!digest) {
    return undefined;
  }

  const params = parseChallenge(digest[1]);
  const algorithm = DIGEST_HASHES[params.algorithm ?? 'MD5'];
  const { realm, nonce } = params;
  if (!algorithm || !realm || !nonce) {
    return undefined;
  }

  const hash = (value: string) =>
    createHash(algorithm).update(value).digest('hex');
  const ha1 = hash(`${connection.username}:${realm}:${connection.password}`);
  const ha2 = hash(`GET:${uri}`);
  const cnonce = randomBytes(8).toString('hex');
  const qop = params.qop
    ?.split(',')
    .map((option) => option.trim())
    .includes('auth');
  const nc = nonceCount(count);
  const response = qop
    ? hash(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`)
    : hash(`${ha1}:${nonce}:${ha2}`);

  // realm, nonce and opaque came out of quoted strings, so they cannot carry a
  // quote back in. The username is operator input and is escaped as the
  // quoted-pair the grammar allows, so it cannot close the field early.
  const fields = [
    `username="${connection.username.replace(/(["\\])/g, '\\$1')}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (qop) {
    fields.push('qop=auth', `nc=${nc}`, `cnonce="${cnonce}"`);
  }
  if (params.opaque) {
    fields.push(`opaque="${params.opaque}"`);
  }
  if (params.algorithm) {
    fields.push(`algorithm=${params.algorithm}`);
  }
  return `Digest ${fields.join(', ')}`;
}

/**
 * One recorder, one entry. The username is in the key because the signature is
 * built from it: a credential change has to invalidate the cached challenge,
 * and it does by simply not finding it.
 */
function challengeKey(connection: DvrConnection): string {
  return `${connection.url}\u0000${connection.username}`;
}

/**
 * What axios puts on the request line, which is what the digest `uri` has to
 * cover: a base URL carrying its own path prefix would otherwise sign a target
 * the recorder never saw, and the signature would be refused for looking wrong
 * rather than for the password being wrong.
 */
function requestTarget(url: string): string {
  const { pathname, search } = new URL(url);
  return `${pathname}${search}`;
}

/** Challenge parameters arrive half quoted, half bare, in no fixed order. */
function parseChallenge(params: string): Record<string, string | undefined> {
  const found: Record<string, string | undefined> = {};
  for (const [, key, quoted, bare] of params.matchAll(
    /([\w-]+)=(?:"([^"]*)"|([^,\s]+))/g,
  )) {
    // First wins: a `Basic realm="..."` listed after the Digest challenge
    // shares parameter names with it, and must not overwrite them.
    if (!(key in found)) {
      found[key] = quoted ?? bare;
    }
  }
  return found;
}
