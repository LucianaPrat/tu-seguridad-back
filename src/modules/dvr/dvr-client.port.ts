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
 * `linked`: this call is the one that wrote the `center` trigger. `alreadyLinked`:
 * the recorder already published it, nothing was written. Never a bare boolean —
 * the caller reports both outcomes as success, but only one of them changed the
 * appliance's configuration.
 */
export type MotionLinkage = 'linked' | 'alreadyLinked';

/**
 * One notification off the recorder's event stream, reduced to the one
 * distinction a caller can act on. `keepalive` covers every notification
 * that is not an active motion trigger — the idle heartbeat this recorder
 * repeats every few seconds included — because it exists to answer one
 * question: is the connection still there. This recorder never announces
 * that motion ended, so nothing else here is an edge case, and silence on
 * the iterable is the only failure signal a caller gets.
 */
export type DvrEvent =
  { kind: 'motion'; externalId: string } | { kind: 'keepalive' };

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

  /**
   * Wires one channel's motion detector to actually publish something this
   * product can see: a `center` entry in that trigger's own notification list.
   * ISAPI's VMD trigger fires internally the moment the grid decides motion
   * happened, but nothing leaves the box unless a notification method is
   * registered for it — `center` is the one this recorder answers a poll
   * against, the same way `record` tells it to write to its own disk and
   * `whiteLightOut` tells it to flash a light. Without this write the polling
   * loop has nothing to observe, no matter how well the grid is tuned.
   *
   * The first method on this port that writes to the appliance rather than
   * reading it, and it belongs behind the port for the same reason `streamUrl`
   * does: the trigger id (`VMD-<port>`), the notification vocabulary (`center`,
   * `record`, `whiteLightOut`, ...) and — the dangerous part — that a write here
   * REPLACES the recorder's whole notification list for that trigger rather than
   * patching it, are this vendor's dialect. A caller above this port has no
   * business knowing any of that, the same way it has no business knowing the
   * two-part channel id `captureSnapshot` builds.
   *
   * Returns which of two things happened rather than a bare success because the
   * two are not the same event: `alreadyLinked` means the recorder was already
   * publishing `center` and nothing was written, `linked` means this call is the
   * one that changed the recorder's stored configuration. A caller auditing
   * "did we just modify hardware state" cannot get that answer from a boolean.
   *
   * Per channel, not per recorder, because eight channels are eight independent
   * writes to eight independent trigger resources with no transaction spanning
   * them. A recorder can accept six of eight and refuse the other two — refuse
   * silently, even, since this hardware can answer `statusCode 1 / OK` and still
   * drop the element it does not implement — and the caller has to be able to
   * say which channel is which. A per-recorder signature could only report the
   * whole space as one verdict, and would have hidden exactly the failure mode
   * this hardware produces.
   */
  abstract linkMotionEvents(
    connection: DvrConnection,
    externalId: string,
  ): Promise<Either<MotionLinkage>>;

  /**
   * Opens the recorder's event push channel and hands back one `DvrEvent`
   * per notification for as long as the connection lives. `keepalive` is
   * every notification that is not an active motion trigger, the idle
   * heartbeat included, and it exists because the caller has no other way
   * to tell "connected and quiet" from "socket dead" — this recorder never
   * signals the end of motion, so nothing on the wire marks that moment,
   * and going quiet is the only thing that ever will.
   *
   * The iterable ends when the recorder closes the connection and throws
   * when the transport breaks; wrapping every notification in its own
   * `Either` would invent a failure mode per notification when there is
   * only one thing that can actually fail here: the connection itself.
   * `Either` covers that one failure, at the point where opening the stream
   * either succeeds or does not.
   *
   * `signal` is the only way to stop it. A consumer parked awaiting the
   * next notification is inside its own loop and cannot break out on its
   * own; cancellation has to reach in from outside.
   *
   * Returns `AsyncIterable<DvrEvent>` rather than a `Readable` so that VMD,
   * multipart and `node:stream` all stay inside the adapter that already
   * owns this vendor's dialect, the same reason `linkMotionEvents` keeps
   * the trigger vocabulary out of this file. A transport type has no
   * business in the port.
   */
  abstract openEventStream(
    connection: DvrConnection,
    signal: AbortSignal,
  ): Promise<Either<AsyncIterable<DvrEvent>>>;
}
