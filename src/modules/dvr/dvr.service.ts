import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import {
  DvrAccessorService,
  DvrCredentials,
} from '../../data/accessors/dvr.accessor';
import { DvrClientPort } from './dvr-client.port';
import { ConfigureDvrDto } from './dto/configure-dvr.dto';
import { DvrConnectionResultDto } from './dto/dvr-connection-result.dto';
import { DvrDto } from './dto/dvr.dto';
import { TestDvrConnectionDto } from './dto/test-dvr-connection.dto';
import { toDvrDto } from './dvr.mapper';

const NO_DVR_MESSAGE = 'This space has no DVR configured yet';

@Injectable()
export class DvrService {
  constructor(
    private readonly dvrAccessor: DvrAccessorService,
    private readonly cameraAccessor: CameraAccessorService,
    private readonly dvrClient: DvrClientPort,
  ) {}

  /**
   * Initialize or re-point the space's recorder. Discovery runs first and a
   * configuration that cannot be reached is never stored: persisting it would
   * leave the space pointing at a recorder nothing can poll, with the previous
   * working credentials already overwritten.
   */
  async configure(
    spaceId: string,
    dto: ConfigureDvrDto,
  ): Promise<Either<DvrDto>> {
    const urlError = validateDvrUrl(dto.url);
    if (urlError) {
      return buildError(ErrorCode.VALIDATION_ERROR, urlError);
    }

    if (!isValidTimezone(dto.timezone)) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        `${dto.timezone} is not a known IANA time zone`,
      );
    }

    const discovery = await this.dvrClient.discoverChannels({
      url: dto.url,
      username: dto.username,
      password: dto.password,
    });
    if (!discovery.ok) {
      await this.dvrAccessor.recordTestResult(spaceId, false);
      return discovery;
    }

    await this.dvrAccessor.upsertConfiguration(spaceId, {
      url: dto.url,
      username: dto.username,
      password: dto.password,
      timezone: dto.timezone,
    });
    const cameras = await this.dvrAccessor.reconcileDiscovery(
      spaceId,
      discovery.data,
    );
    const dvr = await this.dvrAccessor.recordTestResult(spaceId, true);
    if (!dvr) {
      return buildError(ErrorCode.INTERNAL_ERROR, 'DVR configuration was lost');
    }

    return buildData(toDvrDto(dvr, cameras.length));
  }

  async findBySpace(spaceId: string): Promise<Either<DvrDto>> {
    const dvr = await this.dvrAccessor.findBySpaceId(spaceId);
    if (!dvr) {
      return buildError(ErrorCode.NOT_FOUND, NO_DVR_MESSAGE);
    }
    return buildData(
      toDvrDto(dvr, await this.cameraAccessor.countBySpace(spaceId)),
    );
  }

  /**
   * Re-runs discovery against the stored credentials. Channels that answer keep
   * their monitor configuration; channels that no longer answer become
   * unconfigured instead of disappearing, so a recorder hiccup cannot silently
   * delete the operator's zones.
   */
  async rediscover(spaceId: string): Promise<Either<DvrDto>> {
    const credentials =
      await this.dvrAccessor.findCredentialsBySpaceId(spaceId);
    if (!credentials) {
      return buildError(ErrorCode.NOT_FOUND, NO_DVR_MESSAGE);
    }

    const discovery = await this.dvrClient.discoverChannels(
      toConnection(credentials),
    );
    if (!discovery.ok) {
      await this.dvrAccessor.recordTestResult(spaceId, false);
      return discovery;
    }

    const cameras = await this.dvrAccessor.reconcileDiscovery(
      spaceId,
      discovery.data,
    );
    const dvr = await this.dvrAccessor.recordTestResult(spaceId, true);
    if (!dvr) {
      return buildError(ErrorCode.NOT_FOUND, NO_DVR_MESSAGE);
    }

    return buildData(toDvrDto(dvr, cameras.length));
  }

  /**
   * Probe credentials the operator has typed but not stored yet — the UI's
   * "test connection" button. Deliberately writes nothing: no configuration
   * row and no `lastTestAt`, so probing a typo cannot mark the recorder the
   * space is already polling as broken.
   */
  async testConnection(
    dto: TestDvrConnectionDto,
  ): Promise<Either<DvrConnectionResultDto>> {
    const urlError = validateDvrUrl(dto.url);
    if (urlError) {
      return buildError(ErrorCode.VALIDATION_ERROR, urlError);
    }

    const discovery = await this.dvrClient.discoverChannels({
      url: dto.url,
      username: dto.username,
      password: dto.password,
    });
    if (!discovery.ok) {
      return discovery;
    }

    return buildData({ channelCount: discovery.data.length });
  }
}

function toConnection(credentials: DvrCredentials) {
  return {
    url: credentials.url,
    username: credentials.username,
    password: credentials.password,
  };
}

function validateDvrUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname || !['http:', 'https:'].includes(parsed.protocol)) {
      return 'url must start with http:// or https:// and carry a host';
    }
    if (parsed.username || parsed.password) {
      return 'url must not include credentials';
    }
  } catch {
    return 'url must start with http:// or https:// and carry a host';
  }
  return undefined;
}

/**
 * `Intl` is the authority here rather than a regular expression: the timezone
 * is what every rendered timestamp is formatted in, and a plausible-looking
 * string that no runtime knows would only surface much later, in the UI.
 */
function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
