import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { AnalysisResult } from '../pipeline/analysis-result';
import { PipelineService } from '../pipeline/pipeline.service';
import { CameraStatus, CameraStatusRegistry } from './camera-status.registry';
import { toCameraDetailDto, toCameraListItemDto } from './camera.mapper';
import { CameraDto } from './dto/camera.dto';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';

@Injectable()
export class CamerasService {
  constructor(
    private readonly cameraAccessor: CameraAccessorService,
    private readonly statusRegistry: CameraStatusRegistry,
    private readonly pipelineService: PipelineService,
  ) {}

  async create(dto: CreateCameraDto): Promise<Either<CameraDto>> {
    const existing = await this.cameraAccessor.findById(dto.id);
    if (existing) {
      return buildError(ErrorCode.CONFLICT, `Camera ${dto.id} already exists`);
    }

    const camera = await this.cameraAccessor.create({
      id: dto.id,
      name: dto.name,
      enabled: dto.enabled,
      snapshotUrl: dto.snapshotUrl,
      pollingIntervalSeconds: dto.pollingIntervalSeconds,
      confidenceThreshold: dto.confidenceThreshold,
    });
    return buildData(toCameraDetailDto(camera));
  }

  async findAll(): Promise<Either<CameraDto[]>> {
    const cameras = await this.cameraAccessor.findAll();
    return buildData(cameras.map(toCameraListItemDto));
  }

  async findById(id: string): Promise<Either<CameraDto>> {
    const camera = await this.cameraAccessor.findById(id);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }
    return buildData(toCameraDetailDto(camera));
  }

  async update(id: string, dto: UpdateCameraDto): Promise<Either<CameraDto>> {
    const camera = await this.cameraAccessor.findById(id);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }
    const updated = await this.cameraAccessor.update(id, dto);
    return buildData(toCameraDetailDto(updated));
  }

  async delete(id: string): Promise<Either<null>> {
    const camera = await this.cameraAccessor.findById(id);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }
    const zoneCount = await this.cameraAccessor.countZones(id);
    if (zoneCount > 0) {
      return buildError(
        ErrorCode.CONFLICT,
        `Camera ${id} has ${zoneCount} zone(s); delete them first`,
      );
    }
    await this.cameraAccessor.delete(id);
    return buildData(null);
  }

  async getStatus(id: string): Promise<Either<CameraStatus>> {
    const camera = await this.cameraAccessor.findById(id);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }
    return buildData(this.statusRegistry.get(id));
  }

  async analyze(id: string, image: Buffer): Promise<Either<AnalysisResult>> {
    const camera = await this.cameraAccessor.findById(id);
    if (!camera) {
      return buildError(ErrorCode.NOT_FOUND, `Camera ${id} not found`);
    }
    return this.pipelineService.processImage(camera, image);
  }
}
