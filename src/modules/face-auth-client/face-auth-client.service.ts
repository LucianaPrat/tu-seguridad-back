import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import { firstValueFrom } from 'rxjs';
import { EnvNames, ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { withSpan } from '../../observability/tracing.helpers';
import { DetectPersonsResponse } from './detect-persons-response';

@Injectable()
export class FaceAuthClientService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  detectPersons(
    image: Buffer,
    filename: string,
  ): Promise<Either<DetectPersonsResponse>> {
    return withSpan('face-auth.detect', { filename }, async () => {
      const form = new FormData();
      form.append('file', image, filename);

      const apiUrl = this.configService.get<string>(EnvNames.FACE_AUTH_API_URL);
      const timeout = this.configService.get<number>(
        EnvNames.DETECT_TIMEOUT_MS,
      );

      try {
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
        return buildData(response.data);
      } catch (error) {
        return this.mapError(error);
      }
    });
  }

  private mapError(error: unknown): Either<DetectPersonsResponse> {
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
}
