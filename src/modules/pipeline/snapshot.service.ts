import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Camera } from '@prisma/client';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';

@Injectable()
export class SnapshotService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async fetch(camera: Pick<Camera, 'snapshotUrl'>): Promise<Either<Buffer>> {
    const timeout = this.configService.get<number>(
      EnvNames.SNAPSHOT_TIMEOUT_MS,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.get<ArrayBuffer>(camera.snapshotUrl, {
          responseType: 'arraybuffer',
          timeout,
        }),
      );

      const contentType = response.headers['content-type'] as
        string | undefined;
      if (!contentType?.startsWith('image/')) {
        return buildError(
          ErrorCode.UPSTREAM_ERROR,
          'snapshot response was not an image',
        );
      }

      return buildData(Buffer.from(response.data));
    } catch (error) {
      return this.mapError(error);
    }
  }

  private mapError(error: unknown): Either<Buffer> {
    if (!axios.isAxiosError(error)) {
      return buildError(
        ErrorCode.UPSTREAM_ERROR,
        'snapshot fetch failed unexpectedly',
      );
    }

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return buildError(ErrorCode.UPSTREAM_TIMEOUT, 'snapshot fetch timed out');
    }

    const status = error.response?.status;
    return buildError(
      ErrorCode.UPSTREAM_ERROR,
      `snapshot fetch failed (status ${status ?? 'unknown'})`,
    );
  }
}
