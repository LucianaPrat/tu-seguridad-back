import { Snapshot } from '@prisma/client';
import { SnapshotDto } from './dto/snapshot.dto';

/**
 * Mirrors `main.ts`'s global prefix and default version. The UI needs an
 * absolute-on-this-host path it can request with its bearer token; what it must
 * never get is a DVR URL, which is the credential-bearing string this whole
 * indirection exists to keep out of responses.
 */
const SNAPSHOT_ROUTE = '/api/v1/snapshots';

export function snapshotUrl(snapshotId: string): string {
  return `${SNAPSHOT_ROUTE}/${snapshotId}`;
}

export function toSnapshotDto(snapshot: Snapshot): SnapshotDto {
  return {
    id: snapshot.id,
    cameraId: snapshot.cameraId,
    mimeType: snapshot.mimeType,
    byteSize: snapshot.byteSize,
    capturedAt: snapshot.capturedAt,
    url: snapshotUrl(snapshot.id),
  };
}
