import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { ZoneAccessorService } from '../../data/accessors/zone.accessor';
import { CreateZoneDto } from './dto/create-zone.dto';
import { PointDto } from './dto/point.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ValidatePolygonResultDto } from './dto/validate-polygon-result.dto';
import { ZoneDto } from './dto/zone.dto';
import { validatePolygon } from './geometry';
import { toZoneDto } from './zone.mapper';

@Injectable()
export class ZonesService {
  constructor(
    private readonly zoneAccessor: ZoneAccessorService,
    private readonly cameraAccessor: CameraAccessorService,
  ) {}

  async create(cameraId: string, dto: CreateZoneDto): Promise<Either<ZoneDto>> {
    const camera = await this.cameraAccessor.findById(cameraId);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${cameraId} not found`);
    }

    const existing = await this.zoneAccessor.findById(dto.id);
    if (existing) {
      return buildError(ErrorCode.CONFLICT, `Zone ${dto.id} already exists`);
    }

    const violations = validatePolygon(dto.polygon);
    if (violations.length > 0) {
      return buildError(
        ErrorCode.INVALID_POLYGON,
        violations.map((v) => v.message).join('; '),
      );
    }

    const zone = await this.zoneAccessor.create({
      id: dto.id,
      cameraId,
      name: dto.name,
      enabled: dto.enabled,
      polygon: dto.polygon as unknown as Prisma.InputJsonValue,
      geometryVersion: 1,
    });
    return buildData(toZoneDto(zone));
  }

  async findByCamera(cameraId: string): Promise<Either<ZoneDto[]>> {
    const camera = await this.cameraAccessor.findById(cameraId);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${cameraId} not found`);
    }
    const zones = await this.zoneAccessor.findByCamera(cameraId);
    return buildData(zones.map(toZoneDto));
  }

  async findById(id: string): Promise<Either<ZoneDto>> {
    const zone = await this.zoneAccessor.findById(id);
    if (!zone) {
      return buildError(ErrorCode.NOT_FOUND, `Zone ${id} not found`);
    }
    return buildData(toZoneDto(zone));
  }

  async update(id: string, dto: UpdateZoneDto): Promise<Either<ZoneDto>> {
    const zone = await this.zoneAccessor.findById(id);
    if (!zone) {
      return buildError(ErrorCode.NOT_FOUND, `Zone ${id} not found`);
    }

    let geometryVersion = zone.geometryVersion;
    if (dto.polygon) {
      const violations = validatePolygon(dto.polygon);
      if (violations.length > 0) {
        return buildError(
          ErrorCode.INVALID_POLYGON,
          violations.map((v) => v.message).join('; '),
        );
      }
      geometryVersion += 1;
    }

    const updated = await this.zoneAccessor.update(id, {
      name: dto.name,
      enabled: dto.enabled,
      polygon: dto.polygon
        ? (dto.polygon as unknown as Prisma.InputJsonValue)
        : undefined,
      geometryVersion,
    });
    return buildData(toZoneDto(updated));
  }

  async delete(id: string): Promise<Either<null>> {
    const zone = await this.zoneAccessor.findById(id);
    if (!zone) {
      return buildError(ErrorCode.NOT_FOUND, `Zone ${id} not found`);
    }
    await this.zoneAccessor.delete(id);
    return buildData(null);
  }

  async validate(
    id: string,
    overridePolygon?: PointDto[],
  ): Promise<Either<ValidatePolygonResultDto>> {
    let polygon: PointDto[];
    if (overridePolygon) {
      polygon = overridePolygon;
    } else {
      const zone = await this.zoneAccessor.findById(id);
      if (!zone) {
        return buildError(ErrorCode.NOT_FOUND, `Zone ${id} not found`);
      }
      polygon = zone.polygon as unknown as PointDto[];
    }

    const violations = validatePolygon(polygon);
    return buildData({ valid: violations.length === 0, violations });
  }
}
