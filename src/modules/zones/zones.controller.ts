import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { MonitorZoneDto } from './dto/zone.dto';
import { ZonesService } from './zones.service';

@ApiTags('zones')
/**
 * Zones are percentage rectangles over a camera frame, so they survive a
 * resolution change on the recorder. Reads are open to any member; every write
 * is an admin decision, because a zone defines what raises an alert.
 */
@Controller()
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Get('cameras/:cameraId/zones')
  @ApiOperation({
    summary: 'List the monitor zones of a camera',
    description:
      'Every rectangle configured on the camera, each with the alert level it raises. ' +
      'An empty list means the camera is either unmonitored or monitored full-frame.',
  })
  @ApiParam({
    name: 'cameraId',
    description:
      'Camera the zones belong to. Resolved inside the caller space only.',
  })
  @ApiOkResponse({
    type: [MonitorZoneDto],
    description: 'Zones of the camera.',
  })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'No camera with that id in the caller space.',
  })
  findByCamera(
    @CurrentUser() user: JwtPayload,
    @Param('cameraId') cameraId: string,
  ): Promise<Either<MonitorZoneDto[]>> {
    return this.zonesService.findByCamera(user.spaceId, cameraId);
  }

  @Roles(SpaceMemberRole.admin)
  @Post('cameras/:cameraId/zones')
  @ApiOperation({
    summary: 'Create a monitor zone',
    description:
      'Admin only. Adds one percentage rectangle to a camera. Coordinates are percent ' +
      'of frame, not pixels, so the zone keeps its meaning if the recorder changes ' +
      'resolution. The rectangle must stay inside the frame and have a positive area; ' +
      'a rectangle that does not answers `INVALID_ZONE`.',
  })
  @ApiParam({
    name: 'cameraId',
    description:
      'Camera the zones belong to. Resolved inside the caller space only.',
  })
  @ApiCreatedResponse({ type: MonitorZoneDto, description: 'Zone created.' })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body.',
    [ErrorCode.INVALID_ZONE]: 'Rectangle is outside the frame or has no area.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
    [ErrorCode.NOT_FOUND]: 'No camera with that id in the caller space.',
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('cameraId') cameraId: string,
    @Body() dto: CreateZoneDto,
  ): Promise<Either<MonitorZoneDto>> {
    return this.zonesService.create(user.spaceId, cameraId, dto);
  }

  @Get('zones/:id')
  @ApiOperation({
    summary: 'Read a monitor zone',
    description:
      'One rectangle with its alert level and the camera it belongs to.',
  })
  @ApiParam({
    name: 'id',
    description: 'Zone id. Resolved inside the caller space only.',
  })
  @ApiOkResponse({ type: MonitorZoneDto, description: 'The zone.' })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
    [ErrorCode.NOT_FOUND]: 'No zone with that id in the caller space.',
  })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<MonitorZoneDto>> {
    return this.zonesService.findById(user.spaceId, id);
  }

  @Roles(SpaceMemberRole.admin)
  @Put('zones/:id')
  @ApiOperation({
    summary: 'Update a monitor zone',
    description:
      'Admin only. Partial update — the sent fields are merged onto the stored zone and ' +
      'the merged rectangle is what gets validated, so moving one edge cannot push the ' +
      'zone out of the frame.',
  })
  @ApiParam({
    name: 'id',
    description: 'Zone id. Resolved inside the caller space only.',
  })
  @ApiOkResponse({ type: MonitorZoneDto, description: 'Zone after the merge.' })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body.',
    [ErrorCode.INVALID_ZONE]:
      'The merged rectangle is outside the frame or has no area.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
    [ErrorCode.NOT_FOUND]: 'No zone with that id in the caller space.',
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateZoneDto,
  ): Promise<Either<MonitorZoneDto>> {
    return this.zonesService.update(user.spaceId, id, dto);
  }

  @Roles(SpaceMemberRole.admin)
  @Delete('zones/:id')
  @ApiOperation({
    summary: 'Delete a monitor zone',
    description:
      'Admin only. Logical delete: the zone leaves every read and stops raising alerts, ' +
      'the alerts it already raised stay in the history.',
  })
  @ApiParam({
    name: 'id',
    description: 'Zone id. Resolved inside the caller space only.',
  })
  @ApiOkResponse({ description: 'Zone removed. Empty body.' })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
    [ErrorCode.NOT_FOUND]: 'No zone with that id in the caller space.',
  })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<null>> {
    return this.zonesService.delete(user.spaceId, id);
  }
}
