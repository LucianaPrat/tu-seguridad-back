import { Camera } from '@prisma/client';
import { snapshotUrl } from '../snapshots/snapshot.mapper';
import { CameraDto } from './dto/camera.dto';

/**
 * One mapper for list and detail. The setup-era schema needed two because the
 * list had to mask `snapshotUrl`; the column is gone, and with it the class of
 * bug where a new response path forgets to mask.
 */
export function toCameraDto(
  camera: Camera,
  latestSnapshotId?: string | null,
): CameraDto {
  return {
    id: camera.id,
    externalId: camera.externalId,
    name: camera.name,
    location: camera.location,
    status: camera.status,
    isConfigured: camera.isConfigured,
    isEnabled: camera.isEnabled,
    monitorMode: camera.monitorMode,
    alertType: camera.alertType,
    // Prisma hands `Decimal(4,3)` back as its own type; the contract carries the
    // plain 0..1 number, the same conversion the alert mail already makes.
    confidenceThreshold:
      camera.confidenceThreshold === null
        ? null
        : Number(camera.confidenceThreshold),
    minPollSeconds: camera.minPollSeconds,
    lastSnapshotAt: camera.lastSnapshotAt,
    latestSnapshotUrl: latestSnapshotId ? snapshotUrl(latestSnapshotId) : null,
    createdAt: camera.createdAt,
    updatedAt: camera.updatedAt,
  };
}

/** What history stores instead of a foreign key, so renames cannot rewrite it. */
export function toCameraLabel(camera: Camera): string {
  return camera.location ? `${camera.name} – ${camera.location}` : camera.name;
}
