import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EnvNames } from '../../cross/common/constants';
import { buildData, Either } from '../../cross/errors/either';
import { mapUpstreamError } from '../../cross/errors/upstream-error';
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
 */
const replacePath = (name: string) =>
  `/v3/config/paths/replace/${encodeURIComponent(name)}`;

const deletePath = (name: string) =>
  `/v3/config/paths/delete/${encodeURIComponent(name)}`;

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
    const apiUrl = this.configService.get<string>(EnvNames.MEDIAMTX_API_URL);
    // Joi's `.uri()` accepts a trailing slash, and one would give the browser
    // `http://host:8888//<id>/index.m3u8`. Same normalisation the recorder base
    // URL already gets in `http-dvr-client.service.ts`.
    const publicUrl = (
      this.configService.get<string>(EnvNames.MEDIAMTX_PUBLIC_URL) ?? ''
    ).replace(/\/+$/, '');

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
      // Never logged, never rethrown: an axios error carries the request body it
      // was sent with, and that body holds the recorder password in `source`, so
      // only a status reaches the message. `source` is in
      // `SENSITIVE_FIELD_NAMES` as the second line of defence, not the first.
      return mapUpstreamError(error, 'Stream publish');
    }

    return buildData({
      protocol: 'hls',
      url: `${publicUrl}/${encodeURIComponent(pathName)}/index.m3u8`,
    });
  }

  /**
   * A path the media server does not have is the outcome this asks for, so a
   * 404 is success. Anything else is mapped and handed back for the caller to
   * log — no request body here, so unlike `publish` there is nothing in the
   * error that could carry the recorder password.
   */
  async unpublish(pathName: string): Promise<Either<null>> {
    const apiUrl = this.configService.get<string>(EnvNames.MEDIAMTX_API_URL);
    try {
      await firstValueFrom(
        this.httpService.delete(`${apiUrl}${deletePath(pathName)}`, {
          timeout: this.configService.get<number>(EnvNames.MEDIAMTX_TIMEOUT_MS),
          validateStatus: (status) => status < 400 || status === 404,
        }),
      );
    } catch (error) {
      return mapUpstreamError(error, 'Stream unpublish');
    }
    return buildData(null);
  }
}
