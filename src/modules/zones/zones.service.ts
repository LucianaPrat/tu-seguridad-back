import { Injectable } from '@nestjs/common';
import { MonitorMode, Prisma } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { MonitorZoneAccessorService } from '../../data/accessors/zone.accessor';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { MonitorZoneDto } from './dto/zone.dto';
import {
  boundsOf,
  Point,
  Rectangle,
  validatePolygon,
  validateRectangle,
} from './rectangle';
import { toMonitorZoneDto, toZoneArea } from './zone.mapper';

function toJsonOutline(
  outline: Point[] | null | undefined,
): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  return outline
    ? outline.map((point) => ({ x: point.x, y: point.y }))
    : Prisma.DbNull;
}

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
    // An outline is the shape of the zone, so the stored rectangle is derived
    // from it and whatever box the client also sent is ignored: two records of
    // one shape is how the two drift apart.
    const outline = dto.points ?? undefined;
    const rectangle: Rectangle = outline
      ? boundsOf(outline)
      : { x: dto.x, y: dto.y, width: dto.width, height: dto.height };

    const invalid = this.rejectInvalidShape<MonitorZoneDto>(rectangle, outline);
    if (invalid) {
      return invalid;
    }

    const zone = await this.zoneAccessor.create(spaceId, {
      cameraId,
      ...rectangle,
      points: toJsonOutline(outline),
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
   * A partial update still validates the whole shape: moving `x` alone can push
   * an otherwise valid zone past the right edge of the frame.
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

    const current = toZoneArea(zone);
    const movesBox =
      dto.x !== undefined ||
      dto.y !== undefined ||
      dto.width !== undefined ||
      dto.height !== undefined;

    // Outline and rectangle describe one shape. A new outline re-derives the
    // box; moving the box of a zone that has an outline would leave the two
    // describing different areas, so that request is refused rather than
    // quietly discarding what the operator drew. Explicit `points: null` is
    // the operator switching back to the rectangle tool, which is a different
    // request from omitting the field: it drops the outline on purpose and
    // lets the merged box stand as the shape.
    if (dto.points === undefined && movesBox && current.points) {
      return buildError(
        ErrorCode.INVALID_ZONE,
        'send points to reshape a free-hand zone',
      );
    }

    const outline =
      dto.points === null ? undefined : (dto.points ?? current.points);
    const merged: Rectangle = dto.points
      ? boundsOf(dto.points)
      : {
          x: dto.x ?? current.x,
          y: dto.y ?? current.y,
          width: dto.width ?? current.width,
          height: dto.height ?? current.height,
        };
    const invalid = this.rejectInvalidShape<MonitorZoneDto>(merged, outline);
    if (invalid) {
      return invalid;
    }

    const updated = await this.zoneAccessor.update(spaceId, id, {
      ...merged,
      ...(dto.points !== undefined
        ? { points: toJsonOutline(dto.points) }
        : {}),
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

  private rejectInvalidShape<T>(
    rectangle: Rectangle,
    outline?: Point[],
  ): Either<T> | undefined {
    const violations = [
      ...(outline ? validatePolygon(outline) : []),
      ...validateRectangle(rectangle),
    ];
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
