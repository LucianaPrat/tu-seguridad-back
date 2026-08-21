import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { LiveStream, StreamPublisherPort } from './stream-publisher.port';

/**
 * The upstream is pulled only while somebody is watching. MediaMTX does that
 * itself for a static source — it starts the RTSP connection when the first
 * reader asks for the playlist and drops it once the last one leaves — so
 * "on demand" costs a config flag here and no process management at all.
 */
const CLOSE_AFTER = '10s';

/**
 * `replace` rather than `add`: MediaMTX's `add` fails on a path that already
 * exists, and the second viewer of a camera is the normal case, not an error.
 * Replace creates it when absent and overwrites when present, so the call is
 * idempotent without a read first.
 *
 * ponytail: nothing ever deletes a path, so a logically deleted camera leaves
 * one behind. It is inert — the authorization hook refuses every reader whose
 * camera no longer resolves — but the entries accumulate in the media server's
 * config. Delete on camera removal if that ever grows teeth.
 */
const replacePath = (name: string) =>
  `/v3/config/paths/replace/${encodeURIComponent(name)}`;

@Injectable()
export class MediaMtxStreamPublisherService extends StreamPublisherPort {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async publish(
    pathName: string,
    sourceUrl: string,
  ): Promise<Either<LiveStream>> {
    if (!this.configService.get<boolean>(EnvNames.MEDIAMTX_ENABLED)) {
      return buildError(
        ErrorCode.CONFLICT,
        'Live streaming is not configured on this deployment',
      );
    }

    const apiUrl = this.configService.get<string>(EnvNames.MEDIAMTX_API_URL);
    const publicUrl = this.configService.get<string>(
      EnvNames.MEDIAMTX_PUBLIC_URL,
    );

    try {
      await firstValueFrom(
        this.httpService.post(
          `${apiUrl}${replacePath(pathName)}`,
          {
            source: sourceUrl,
            sourceOnDemand: true,
            sourceOnDemandCloseAfter: CLOSE_AFTER,
          },
          {
            timeout: this.configService.get<number>(
              EnvNames.MEDIAMTX_TIMEOUT_MS,
            ),
          },
        ),
      );
    } catch (error) {
      return this.mapError(error);
    }

    return buildData({
      protocol: 'hls',
      url: `${publicUrl}/${pathName}/index.m3u8`,
    });
  }

  /**
   * The thrown value is never logged and never rethrown. An axios error carries
   * the request body it was sent with, and that body holds the recorder
   * password in `source` — so only a status reaches the message. `source` is in
   * `SENSITIVE_FIELD_NAMES` as the second line of defence, not the first.
   */
  private mapError<T>(error: unknown): Either<T> {
    if (!axios.isAxiosError(error)) {
      return buildError(ErrorCode.UPSTREAM_ERROR, 'Stream publish failed');
    }
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return buildError(ErrorCode.UPSTREAM_TIMEOUT, 'Stream publish timed out');
    }
    return buildError(
      ErrorCode.UPSTREAM_ERROR,
      `Stream publish failed (status ${error.response?.status ?? 'unreachable'})`,
    );
  }
}
