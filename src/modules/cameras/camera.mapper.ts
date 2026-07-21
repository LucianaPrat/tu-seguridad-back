import { Camera } from '@prisma/client';
import { CameraDto } from './dto/camera.dto';

const MASKED_SNAPSHOT_URL = '***';

export function toCameraDetailDto(camera: Camera): CameraDto {
  return {
    id: camera.id,
    name: camera.name,
    enabled: camera.enabled,
    snapshotUrl: camera.snapshotUrl,
    pollingIntervalSeconds: camera.pollingIntervalSeconds,
    confidenceThreshold: camera.confidenceThreshold,
    createdAt: camera.createdAt,
    updatedAt: camera.updatedAt,
  };
}

export function toCameraListItemDto(camera: Camera): CameraDto {
  return { ...toCameraDetailDto(camera), snapshotUrl: MASKED_SNAPSHOT_URL };
}
