import { Injectable } from '@nestjs/common';
import { MonitorMode } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { MonitorZoneAccessorService } from '../../data/accessors/zone.accessor';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { MonitorZoneDto } from './dto/zone.dto';
import { Rectangle, validateRectangle } from './rectangle';
import { toMonitorZoneDto, toRectangle } from './zone.mapper';

@Injectable()
export class ZonesService {
  constructor(
    private readonly zoneAccessor: MonitorZoneAccessorService,
    private readonly cameraAccessor: CameraAccessorService,
  ) {}

  async findByCamera(
    spaceId: string,
    cameraId: string,
  ): Promise<Either<MonitorZoneDto[]>> {
    const camera = await this.cameraAccessor.findById(spaceId, cameraId);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${cameraId} not found`);
    }
    const zones = await this.zoneAccessor.findByCamera(spaceId, cameraId);
    return buildData(zones.map(toMonitorZoneDto));
  }

  async create(
    spaceId: string,
    cameraId: string,
    dto: CreateZoneDto,
  ): Promise<Either<MonitorZoneDto>> {
    const invalid = this.rejectInvalidRectangle<MonitorZoneDto>(dto);
    if (invalid) {
      return invalid;
    }

    const zone = await this.zoneAccessor.create(spaceId, {
      cameraId,
      x: dto.x,
      y: dto.y,
      width: dto.width,
      height: dto.height,
      alertType: dto.alertType,
    });
    if (!zone) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${cameraId} not found`);
    }

    await this.syncCameraConfiguration(spaceId, cameraId);
    return buildData(toMonitorZoneDto(zone));
  }

  async findById(spaceId: string, id: string): Promise<Either<MonitorZoneDto>> {
    const zone = await this.zoneAccessor.findById(spaceId, id);
    if (!zone) {
      return buildError(ErrorCode.NOT_FOUND, `Zone ${id} not found`);
    }
    return buildData(toMonitorZoneDto(zone));
  }

  /**
   * A partial update still validates the whole rectangle: moving `x` alone can
   * push an otherwise valid zone past the right edge of the frame.
   */
  async update(
    spaceId: string,
    id: string,
    dto: UpdateZoneDto,
  ): Promise<Either<MonitorZoneDto>> {
    const zone = await this.zoneAccessor.findById(spaceId, id);
    if (!zone) {
      return buildError(ErrorCode.NOT_FOUND, `Zone ${id} not found`);
    }

    const current = toRectangle(zone);
    const merged: Rectangle = {
      x: dto.x ?? current.x,
      y: dto.y ?? current.y,
      width: dto.width ?? current.width,
      height: dto.height ?? current.height,
    };
    const invalid = this.rejectInvalidRectangle<MonitorZoneDto>(merged);
    if (invalid) {
      return invalid;
    }

    const updated = await this.zoneAccessor.update(spaceId, id, {
      ...merged,
      alertType: dto.alertType ?? zone.alertType,
    });
    if (!updated) {
      return buildError(ErrorCode.NOT_FOUND, `Zone ${id} not found`);
    }
    return buildData(toMonitorZoneDto(updated));
  }

  /** Logical delete: alert history that points at this zone stays readable. */
  async delete(spaceId: string, id: string): Promise<Either<null>> {
    const zone = await this.zoneAccessor.findById(spaceId, id);
    if (!zone) {
      return buildError(ErrorCode.NOT_FOUND, `Zone ${id} not found`);
    }

    const deleted = await this.zoneAccessor.softDelete(spaceId, id);
    if (!deleted) {
      return buildError(ErrorCode.NOT_FOUND, `Zone ${id} not found`);
    }

    await this.syncCameraConfiguration(spaceId, zone.cameraId);
    return buildData(null);
  }

  private rejectInvalidRectangle<T>(
    rectangle: Rectangle,
  ): Either<T> | undefined {
    const violations = validateRectangle(rectangle);
    if (violations.length === 0) {
      return undefined;
    }
    return buildError(
      ErrorCode.INVALID_ZONE,
      violations.map((violation) => violation.message).join('; '),
    );
  }

  /**
   * A partial-mode camera is configured exactly while it has a zone to
   * evaluate. Deleting the last one disarms the camera rather than leaving it
   * polled with nothing to look at.
   */
  private async syncCameraConfiguration(
    spaceId: string,
    cameraId: string,
  ): Promise<void> {
    const camera = await this.cameraAccessor.findById(spaceId, cameraId);
    if (camera?.monitorMode !== MonitorMode.partial) {
      return;
    }
    const zoneCount = await this.cameraAccessor.countMonitorZones(
      spaceId,
      cameraId,
    );
    await this.cameraAccessor.update(spaceId, cameraId, {
      isConfigured: zoneCount > 0,
    });
  }
}
