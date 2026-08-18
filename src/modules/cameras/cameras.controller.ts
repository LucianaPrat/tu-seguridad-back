import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { Either } from '../../cross/errors/either';
import { AnalysisResult } from '../pipeline/analysis-result';
import { SnapshotDto } from '../snapshots/dto/snapshot.dto';
import { CameraPipelineStatus } from './camera-status.registry';
import { CamerasService } from './cameras.service';
import { CameraDto } from './dto/camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';

@ApiTags('cameras')
@ApiBearerAuth()
@Controller('cameras')
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  @Get()
  @ApiOkResponse({ type: [CameraDto] })
  findAll(@CurrentUser() user: JwtPayload): Promise<Either<CameraDto[]>> {
    return this.camerasService.findAll(user.spaceId);
  }

  @Get(':id')
  @ApiOkResponse({ type: CameraDto })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<CameraDto>> {
    return this.camerasService.findById(user.spaceId, id);
  }

  /** Monitor behavior is space configuration, so it is an admin's to change. */
  @Roles(SpaceMemberRole.admin)
  @Put(':id')
  @ApiOkResponse({ type: CameraDto })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCameraDto,
  ): Promise<Either<CameraDto>> {
    return this.camerasService.update(user.spaceId, id, dto);
  }

  @Roles(SpaceMemberRole.admin)
  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<null>> {
    return this.camerasService.delete(user.spaceId, id);
  }

  @Get(':id/status')
  status(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<CameraPipelineStatus>> {
    return this.camerasService.getStatus(user.spaceId, id);
  }

  @HttpCode(HttpStatus.CREATED)
  @Post(':id/snapshots')
  @ApiOkResponse({ type: SnapshotDto })
  capture(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<SnapshotDto>> {
    return this.camerasService.capture(user.spaceId, id);
  }

  /**
   * Manual detection run. The size ceiling lives in the service, against the
   * same `SNAPSHOT_MAX_BYTES` the stored frames use: an analyzed image that
   * raises an alert is stored, so accepting one that could not be persisted
   * would only fail later.
   */
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
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        // Magic numbers first, declared type only as the fallback: the
        // detector needs an actual image, and a client that labels a script
        // `.jpg` must not get one through. The fallback keeps the route usable
        // where `file-type`'s ESM entry point cannot be loaded.
        .addFileTypeValidator({
          fileType: /^image\//,
          fallbackToMimetype: true,
        })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ): Promise<Either<AnalysisResult>> {
    return this.camerasService.analyze(
      user.spaceId,
      id,
      file.buffer,
      file.mimetype,
    );
  }
}
