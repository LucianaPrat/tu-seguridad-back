import { CameraStatus } from '@prisma/client';
import { Either } from '../../cross/errors/either';

/** Everything the client needs to talk to one recorder. Never logged, never a DTO. */
export interface DvrConnection {
  url: string;
  username: string;
  password: string;
}

export interface DiscoveredChannel {
  externalId: string;
  name: string;
  location?: string | null;
  status: CameraStatus;
}

export interface CapturedImage {
  data: Buffer;
  mimeType: string;
  byteSize: number;
  sha256: string;
  capturedAt: Date;
}

/**
 * The seam between the product and whatever recorder a space actually owns.
 *
 * Only two operations exist because only two are needed: listing the channels
 * (which doubles as the connectivity and credential test — a recorder that
 * answers with its channel list is reachable and accepted the password) and
 * pulling one channel's current frame. Polling versus DVR push stays deferred;
 * both transports call these same methods, so neither one owns the schema.
 */
export abstract class DvrClientPort {
  abstract discoverChannels(
    connection: DvrConnection,
  ): Promise<Either<DiscoveredChannel[]>>;

  abstract captureSnapshot(
    connection: DvrConnection,
    externalId: string,
  ): Promise<Either<CapturedImage>>;

  /**
   * The RTSP URL of one channel's live stream, credentials included.
   *
   * Pure string building — nothing here can tell whether the recorder answers,
   * so a URL coming back is not a claim that the stream plays. It returns
   * `Either` for one reason: a stored `externalId` is still external input and
   * has to be refused before it lands in a URL.
   *
   * Third method on a port that justified having only two, because the channel
   * numbering it encodes is the same vendor dialect `captureSnapshot` already
   * speaks. A media server that only knows "some RTSP URL" is the alternative,
   * and that puts the recorder's dialect in the media server's configuration.
   */
  abstract streamUrl(
    connection: DvrConnection,
    externalId: string,
  ): Either<string>;
}
