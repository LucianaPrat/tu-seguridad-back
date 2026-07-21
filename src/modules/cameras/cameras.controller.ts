import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Either } from '../../cross/errors/either';
import { CameraStatus } from './camera-status.registry';
import { CamerasService } from './cameras.service';
import { CameraDto } from './dto/camera.dto';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';

@ApiTags('cameras')
@ApiBearerAuth()
@Controller('cameras')
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  @Post()
  create(@Body() dto: CreateCameraDto): Promise<Either<CameraDto>> {
    return this.camerasService.create(dto);
  }

  @Get()
  findAll(): Promise<Either<CameraDto[]>> {
    return this.camerasService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Either<CameraDto>> {
    return this.camerasService.findById(id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCameraDto,
  ): Promise<Either<CameraDto>> {
    return this.camerasService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<Either<null>> {
    return this.camerasService.delete(id);
  }

  @Get(':id/status')
  status(@Param('id') id: string): Promise<Either<CameraStatus>> {
    return this.camerasService.getStatus(id);
  }
}
