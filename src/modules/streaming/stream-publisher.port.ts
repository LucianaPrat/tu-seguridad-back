import { Either } from '../../cross/errors/either';

export interface LiveStream {
  /**
   * Named in the contract from the first response so the frontend branches on
   * the field rather than on the file extension. WebRTC beside HLS is a value
   * added here, not a second endpoint.
   */
  protocol: 'hls';
  url: string;
}

/**
 * The seam between the product and whatever restreams the recorder.
 *
 * Hand it a path name and an RTSP source, get back the URL a browser can play,
 * and tell it when a path should stop existing. Everything about how the stream
 * is pulled, repackaged and expired belongs behind this line — this process
 * never touches a media packet.
 *
 * A port for one implementation, deliberately, for the same reason
 * `DvrClientPort` and `CredentialDeliveryPort` are: it is what lets the e2e
 * suite boot the whole app with no media server anywhere on the network.
 */
export abstract class StreamPublisherPort {
  abstract publish(
    pathName: string,
    sourceUrl: string,
  ): Promise<Either<LiveStream>>;

  /**
   * Removes a path. Called when a camera is deleted, and never on the request
   * path, so its failure is a housekeeping problem rather than a user-visible
   * one — a path nobody can read is inert, because the authorization hook
   * refuses every reader whose camera no longer resolves.
   */
  abstract unpublish(pathName: string): Promise<Either<null>>;
}
