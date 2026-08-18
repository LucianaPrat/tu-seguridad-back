import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CameraStatus } from '@prisma/client';
import axios, { AxiosRequestConfig } from 'axios';
import { createHash } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import {
  CapturedImage,
  DiscoveredChannel,
  DvrClientPort,
  DvrConnection,
} from './dvr-client.port';

/**
 * Shape the recorder is expected to answer `GET {url}/api/channels` with. The
 * real appliance protocol (ISAPI, ONVIF, a vendor SDK) is not decided yet, so
 * this adapter speaks the smallest contract that carries what the schema needs
 * and stays the only file that changes when the appliance is chosen.
 */
interface ChannelPayload {
  id?: unknown;
  name?: unknown;
  location?: unknown;
  online?: unknown;
}

const CHANNELS_PATH = '/api/channels';
const SNAPSHOT_PATH = (externalId: string) =>
  `${CHANNELS_PATH}/${encodeURIComponent(externalId)}/snapshot`;

@Injectable()
export class HttpDvrClientService extends DvrClientPort {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async discoverChannels(
    connection: DvrConnection,
  ): Promise<Either<DiscoveredChannel[]>> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<ChannelPayload[]>(
          this.endpoint(connection, CHANNELS_PATH),
          this.requestConfig(connection, {
            timeout: this.configService.get<number>(EnvNames.DVR_TIMEOUT_MS),
          }),
        ),
      );
      if (!Array.isArray(response.data)) {
        return buildError(
          ErrorCode.UPSTREAM_ERROR,
          'DVR channel listing was not a list',
        );
      }
      return buildData(response.data.flatMap(toDiscoveredChannel));
    } catch (error) {
      return this.mapError(error, 'DVR channel discovery');
    }
  }

  async captureSnapshot(
    connection: DvrConnection,
    externalId: string,
  ): Promise<Either<CapturedImage>> {
    const maxBytes = this.maxSnapshotBytes();

    try {
      const response = await firstValueFrom(
        this.httpService.get<ArrayBuffer>(
          this.endpoint(connection, SNAPSHOT_PATH(externalId)),
          this.requestConfig(connection, {
            responseType: 'arraybuffer',
            timeout: this.configService.get<number>(
              EnvNames.SNAPSHOT_TIMEOUT_MS,
            ),
            // Aborts the transfer mid-stream instead of buffering an
            // oversized image just to reject it after the fact.
            maxContentLength: maxBytes,
          }),
        ),
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

      return buildData({
        data,
        mimeType,
        byteSize: data.byteLength,
        sha256: createHash('sha256').update(data).digest('hex'),
        capturedAt: new Date(),
      });
    } catch (error) {
      return this.mapError(error, 'DVR snapshot fetch');
    }
  }

  private maxSnapshotBytes(): number {
    return this.configService.getOrThrow<number>(EnvNames.SNAPSHOT_MAX_BYTES);
  }

  /** LAN recorders are the normal case, so the base URL is joined, never parsed. */
  private endpoint(connection: DvrConnection, path: string): string {
    return `${connection.url.replace(/\/+$/, '')}${path}`;
  }

  private requestConfig(
    connection: DvrConnection,
    overrides: AxiosRequestConfig,
  ): AxiosRequestConfig {
    return {
      auth: { username: connection.username, password: connection.password },
      ...overrides,
    };
  }

  private mapError<T>(error: unknown, operation: string): Either<T> {
    if (!axios.isAxiosError(error)) {
      return buildError(ErrorCode.UPSTREAM_ERROR, `${operation} failed`);
    }

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return buildError(ErrorCode.UPSTREAM_TIMEOUT, `${operation} timed out`);
    }

    const status = error.response?.status;
    // A recorder that answers 401/403 is reachable: what is wrong is the
    // configuration the operator just submitted, so this is their 400, not a
    // 502 about somebody else's outage.
    if (status === 401 || status === 403) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        'DVR rejected the supplied credentials',
      );
    }

    return buildError(
      ErrorCode.UPSTREAM_ERROR,
      `${operation} failed (status ${status ?? 'unreachable'})`,
    );
  }
}

function toDiscoveredChannel(channel: ChannelPayload): DiscoveredChannel[] {
  const externalId =
    typeof channel.id === 'string' || typeof channel.id === 'number'
      ? String(channel.id)
      : undefined;
  if (!externalId) {
    return [];
  }
  return [
    {
      externalId,
      name: typeof channel.name === 'string' ? channel.name : externalId,
      location: typeof channel.location === 'string' ? channel.location : null,
      status:
        channel.online === false ? CameraStatus.offline : CameraStatus.online,
    },
  ];
}
