import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Either } from '../../cross/errors/either';
import { AnalysisResult } from '../pipeline/analysis-result';
import { CameraStatus } from './camera-status.registry';
import { CamerasService } from './cameras.service';
import { CameraDto } from './dto/camera.dto';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';

const MAX_ANALYZE_FILE_BYTES = 10 * 1024 * 1024;

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

  @Post(':id/analyze')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  analyze(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: MAX_ANALYZE_FILE_BYTES })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ): Promise<Either<AnalysisResult>> {
    return this.camerasService.analyze(id, file.buffer);
  }
}
