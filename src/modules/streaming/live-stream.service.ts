import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Camera } from '@prisma/client';
import { verifyAccessToken } from '../../cross/common/access-token';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { DvrAccessorService } from '../../data/accessors/dvr.accessor';
import { DvrClientPort } from '../dvr/dvr-client.port';
import { LiveStreamDto } from './dto/live-stream.dto';
import {
  StreamAuthorizationDto,
  StreamAuthorizationResultDto,
} from './dto/stream-authorization.dto';
import { StreamPublisherPort } from './stream-publisher.port';

/** The only action a reader is ever granted. */
const READ_ACTION = 'read';

/** The only transport this API hands out, so the only one it authorizes. */
const HLS_PROTOCOL = 'hls';

/**
 * A reader's playlist and every one of its segments reach `authorize`, so the
 * camera lookup would be one database round trip per segment per viewer. The
 * space and the path together already decide the answer, so a few seconds of
 * memo collapse a viewer's segment storm into a single read.
 *
 * It weakens nothing the hook checks: the token is verified on every call before
 * the memo is consulted, so an expired or revoked credential is refused whatever
 * the memo holds. Only the camera lookup is skipped, and `isEnabled` is a switch
 * an operator flips, not a security boundary — it takes effect within the TTL.
 *
 * ponytail: a plain Map, dropped wholesale when it passes the cap. Entries are
 * one per camera being watched, and refilling costs one read each, so an LRU can
 * wait until that is measurable.
 */
const AUTHORIZATION_MEMO_TTL_MS = 3_000;
const AUTHORIZATION_MEMO_MAX_ENTRIES = 1_000;

@Injectable()
export class LiveStreamService {
  private readonly logger = new Logger(LiveStreamService.name);

  constructor(
    private readonly cameraAccessor: CameraAccessorService,
    private readonly dvrAccessor: DvrAccessorService,
    private readonly dvrClient: DvrClientPort,
    private readonly publisher: StreamPublisherPort,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** `(space, path)` to the moment the pair was last authorized. */
  private readonly recentAuthorizations = new Map<string, number>();

  /**
   * Registers the camera with the media server and answers where to play it.
   *
   * The path name is the camera id, not a secret: authorization happens on
   * every playlist and segment request through `authorize` below, so a leaked
   * URL is worth nothing without a live token. That is what keeps the recorder
   * password out of anything the browser holds, and keeps this response free of
   * an expiry the caller would have to renew — the access token is the clock.
   */
  async start(
    spaceId: string,
    cameraId: string,
  ): Promise<Either<LiveStreamDto>> {
    // Checked here rather than inside the publisher so that streaming being off
    // costs no database round trip and never decrypts the recorder password for
    // a request whose only possible answer is CONFLICT.
    if (!this.configService.get<boolean>(EnvNames.MEDIAMTX_ENABLED)) {
      return buildError(
        ErrorCode.CONFLICT,
        'Live streaming is not configured on this deployment',
      );
    }

    const camera = await this.cameraAccessor.findById(spaceId, cameraId);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${cameraId} not found`);
    }

    const unusable = this.rejectUnusableCamera<LiveStreamDto>(camera);
    if (unusable) {
      return unusable;
    }

    const credentials =
      await this.dvrAccessor.findCredentialsBySpaceId(spaceId);
    if (!credentials) {
      return buildError(
        ErrorCode.NOT_FOUND,
        'This space has no recorder configured',
      );
    }

    const source = this.dvrClient.streamUrl(
      {
        url: credentials.url,
        username: credentials.username,
        password: credentials.password,
      },
      camera.externalId,
    );
    if (!source.ok) {
      return source;
    }

    return this.publisher.publish(camera.id, source.data);
  }

  /**
   * The media server's authorization hook, called for the playlist and for
   * every segment.
   *
   * Read-only and HLS-only by construction. A granted `publish` would let a
   * caller push their own video into a camera's path, and the dashboard would
   * render it as that camera's feed — so the action is checked before the token
   * is even looked at.
   */
  async authorize(
    request: StreamAuthorizationDto,
  ): Promise<Either<StreamAuthorizationResultDto>> {
    if (request.action !== READ_ACTION) {
      return buildError(
        ErrorCode.FORBIDDEN,
        `Only ${READ_ACTION} is authorized on a camera stream`,
      );
    }
    if (request.protocol && request.protocol !== HLS_PROTOCOL) {
      return buildError(
        ErrorCode.FORBIDDEN,
        `Only ${HLS_PROTOCOL} is authorized on a camera stream`,
      );
    }

    const verified = verifyAccessToken(
      this.jwtService,
      this.configService,
      request.token,
    );
    if (!verified.ok) {
      return verified;
    }
    // The global profile gate never runs here — the token arrives in a body, so
    // no guard sees it. An invited account with no password yet reaches nothing
    // else, and must not reach a camera feed either.
    if (!verified.data.profileCompleted) {
      return buildError(
        ErrorCode.FORBIDDEN,
        'Caller has not completed their profile',
      );
    }

    const memoKey = `${verified.data.spaceId}\u0000${request.path}`;
    if (this.wasRecentlyAuthorized(memoKey)) {
      return buildData({ authorized: true });
    }

    const camera = await this.cameraAccessor.findById(
      verified.data.spaceId,
      request.path,
    );
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, 'No such camera in this space');
    }

    const unusable =
      this.rejectUnusableCamera<StreamAuthorizationResultDto>(camera);
    if (unusable) {
      return unusable;
    }

    this.rememberAuthorization(memoKey);
    return buildData({ authorized: true });
  }

  /**
   * Everything this service remembers about a camera, dropped when the camera
   * is. The memo entry would expire on its own within seconds; the media-server
   * path would not, and would sit in its config for as long as the process
   * lives.
   *
   * Best-effort by construction. The camera is gone from the API either way and
   * a leftover path admits nobody, so a media server that refuses this is
   * logged and nothing more — never a reason to fail the delete the operator
   * actually asked for.
   */
  async forget(spaceId: string, cameraId: string): Promise<void> {
    this.recentAuthorizations.delete(`${spaceId}\u0000${cameraId}`);

    if (!this.configService.get<boolean>(EnvNames.MEDIAMTX_ENABLED)) {
      return;
    }
    const removed = await this.publisher.unpublish(cameraId);
    if (!removed.ok) {
      this.logger.warn(
        `could not remove the media server path for camera ${cameraId}: ${removed.message}`,
      );
    }
  }

  private wasRecentlyAuthorized(key: string): boolean {
    const authorizedAt = this.recentAuthorizations.get(key);
    if (authorizedAt === undefined) {
      return false;
    }
    if (Date.now() - authorizedAt < AUTHORIZATION_MEMO_TTL_MS) {
      return true;
    }
    this.recentAuthorizations.delete(key);
    return false;
  }

  private rememberAuthorization(key: string): void {
    if (this.recentAuthorizations.size >= AUTHORIZATION_MEMO_MAX_ENTRIES) {
      this.recentAuthorizations.clear();
    }
    this.recentAuthorizations.set(key, Date.now());
  }

  /**
   * `findById` already excludes a soft-deleted camera, so the operator switch is
   * the only thing left to check.
   *
   * Deliberately **not** `isConfigured`, unlike the detection pipeline: a camera
   * with no monitor configuration is exactly the one an operator is about to
   * configure, and they need to see it to draw a zone on it. `status` is not
   * checked either — it is a poll-time observation, and polling is off by
   * default in dev, so gating on it would refuse every working camera on a
   * developer's machine.
   */
  private rejectUnusableCamera<T>(camera: Camera): Either<T> | undefined {
    if (!camera.isEnabled) {
      return buildError(ErrorCode.CONFLICT, `Camera ${camera.id} is disabled`);
    }
    return undefined;
  }
}
