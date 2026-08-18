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
}
