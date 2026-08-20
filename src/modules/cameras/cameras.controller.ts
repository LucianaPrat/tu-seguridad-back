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
  ApiBody,
  ApiCreatedResponse,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { ErrorCode } from '../../cross/common/constants';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { AnalysisResult } from '../pipeline/analysis-result';
import { SnapshotDto } from '../snapshots/dto/snapshot.dto';
import { CameraPipelineStatus } from './camera-status.registry';
import { CamerasService } from './cameras.service';
import { CameraDto } from './dto/camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';

@ApiTags('cameras')
@Controller('cameras')
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  @Get()
  @ApiOperation({
    summary: 'List the cameras of the space',
    description:
      'Every camera discovered on the space recorder, soft-deleted ones excluded. Each ' +
      'carries its discovery fields, its monitor configuration and a derived ' +
      '`latestSnapshotUrl`. A camera the recorder stopped reporting stays in the list ' +
      'with `isConfigured: false` rather than disappearing.',
  })
  @ApiOkResponse({
    type: [CameraDto],
    description: 'Cameras of the caller space.',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
  })
  findAll(@CurrentUser() user: JwtPayload): Promise<Either<CameraDto[]>> {
    return this.camerasService.findAll(user.spaceId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read one camera',
    description:
      'Full detail for a single camera: discovery fields, monitor configuration and the ' +
      'derived `latestSnapshotUrl`. No recorder URL or credential is on this shape — ' +
      'the recorder is read from `GET /dvr`, and its password never leaves the process.',
  })
  @ApiParam({
    name: 'id',
    description: 'Camera id. Resolved inside the caller space only.',
  })
  @ApiOkResponse({ type: CameraDto, description: 'The camera.' })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'No camera with that id in the caller space.',
  })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<CameraDto>> {
    return this.camerasService.findById(user.spaceId, id);
  }

  /** Monitor behavior is space configuration, so it is an admin's to change. */
  @Roles(SpaceMemberRole.admin)
  @Put(':id')
  @ApiOperation({
    summary: 'Update a camera',
    description:
      'Admin only. Operator-editable fields only — `externalId` and `status` come from ' +
      'discovery and are rejected here. Switching a camera to full-frame monitoring ' +
      'requires an `alertType`, since there are no zones to take the alert level from.',
  })
  @ApiParam({
    name: 'id',
    description: 'Camera id. Resolved inside the caller space only.',
  })
  @ApiOkResponse({ type: CameraDto, description: 'Camera after the update.' })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Malformed body, a rejected discovery field, or full-frame monitoring without an alertType.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
    [ErrorCode.NOT_FOUND]: 'No camera with that id in the caller space.',
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCameraDto,
  ): Promise<Either<CameraDto>> {
    return this.camerasService.update(user.spaceId, id, dto);
  }

  @Roles(SpaceMemberRole.admin)
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a camera',
    description:
      'Admin only. Logical delete: the camera leaves every read and the DVR poll list, ' +
      'its alert history is kept. A later discovery run can bring the same channel back.',
  })
  @ApiParam({
    name: 'id',
    description: 'Camera id. Resolved inside the caller space only.',
  })
  @ApiOkResponse({ description: 'Camera removed. Empty body.' })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
    [ErrorCode.NOT_FOUND]: 'No camera with that id in the caller space.',
  })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<null>> {
    return this.camerasService.delete(user.spaceId, id);
  }

  @Get(':id/status')
  @ApiOperation({
    summary: 'Read the pipeline status of a camera',
    description:
      'Live view of the polling pipeline for one camera: last poll, last success, last ' +
      'error and its code, upstream latency, and current occupancy per monitored area. ' +
      'Held in memory, so it resets when the process restarts.',
  })
  @ApiParam({
    name: 'id',
    description: 'Camera id. Resolved inside the caller space only.',
  })
  // ponytail: `CameraPipelineStatus` is an interface, so OpenAPI gets no schema for it
  // — response DTO class if the frontend needs the shape published.
  @ApiOkResponse({
    description:
      'Pipeline status: `lastPollAt`, `lastSuccessAt`, `lastErrorCode`, latency and per-area occupancy.',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'No camera with that id in the caller space.',
  })
  status(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<CameraPipelineStatus>> {
    return this.camerasService.getStatus(user.spaceId, id);
  }

  @HttpCode(HttpStatus.CREATED)
  @Post(':id/snapshots')
  @ApiOperation({
    summary: 'Capture a snapshot now',
    description:
      'Pulls a frame from the recorder immediately instead of waiting for the next ' +
      'poll, stores it, and answers its metadata including the authenticated URL to ' +
      'read the bytes from `GET /snapshots/{id}`. Runs no detection — use ' +
      '`POST /cameras/{id}/analyze` for that.',
  })
  @ApiParam({
    name: 'id',
    description: 'Camera id. Resolved inside the caller space only.',
  })
  @ApiCreatedResponse({
    type: SnapshotDto,
    description: 'Frame captured and stored.',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'No camera with that id in the caller space.',
    [ErrorCode.VALIDATION_ERROR]:
      'The recorder returned a frame over the stored-size limit.',
    [ErrorCode.UPSTREAM_ERROR]:
      'The recorder refused the request or answered an error.',
    [ErrorCode.UPSTREAM_TIMEOUT]: 'The recorder did not answer in time.',
  })
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
  @ApiOperation({
    summary: 'Analyze an uploaded frame',
    description:
      'Runs the detection pipeline synchronously against an image you upload, as the ' +
      'manual path for when the recorder is unreachable. Answers the detected persons, ' +
      'the per-zone results and any alerts raised; a frame that raises an alert is ' +
      'stored, the rest are not. The upload must be a real image — the magic numbers ' +
      'are checked, not just the declared type — and must fit `SNAPSHOT_MAX_BYTES`.',
  })
  @ApiParam({
    name: 'id',
    description: 'Camera id. Resolved inside the caller space only.',
  })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  // ponytail: `AnalysisResult` is an interface, so OpenAPI gets no schema for it
  // — response DTO class if the frontend needs the shape published.
  @ApiOkResponse({
    description:
      'Detection result: `persons`, `zoneResults` and the `alerts` raised, if any.',
  })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Missing file, a file that is not an image, or one over the size limit.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'No camera with that id in the caller space.',
    [ErrorCode.CONFLICT]:
      'The camera is disabled or has no monitoring configured.',
    [ErrorCode.UPSTREAM_ERROR]:
      'The detection upstream failed, or its circuit is open.',
    [ErrorCode.UPSTREAM_TIMEOUT]:
      'The detection upstream did not answer in time.',
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
