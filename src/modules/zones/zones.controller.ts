import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { Either } from '../../cross/errors/either';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { MonitorZoneDto } from './dto/zone.dto';
import { ZonesService } from './zones.service';

@ApiTags('zones')
@ApiBearerAuth()
@Controller()
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Get('cameras/:cameraId/zones')
  @ApiOkResponse({ type: [MonitorZoneDto] })
  findByCamera(
    @CurrentUser() user: JwtPayload,
    @Param('cameraId') cameraId: string,
  ): Promise<Either<MonitorZoneDto[]>> {
    return this.zonesService.findByCamera(user.spaceId, cameraId);
  }

  @Roles(SpaceMemberRole.admin)
  @Post('cameras/:cameraId/zones')
  @ApiOkResponse({ type: MonitorZoneDto })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('cameraId') cameraId: string,
    @Body() dto: CreateZoneDto,
  ): Promise<Either<MonitorZoneDto>> {
    return this.zonesService.create(user.spaceId, cameraId, dto);
  }

  @Get('zones/:id')
  @ApiOkResponse({ type: MonitorZoneDto })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<MonitorZoneDto>> {
    return this.zonesService.findById(user.spaceId, id);
  }

  @Roles(SpaceMemberRole.admin)
  @Put('zones/:id')
  @ApiOkResponse({ type: MonitorZoneDto })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateZoneDto,
  ): Promise<Either<MonitorZoneDto>> {
    return this.zonesService.update(user.spaceId, id, dto);
  }

  @Roles(SpaceMemberRole.admin)
  @Delete('zones/:id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Either<null>> {
    return this.zonesService.delete(user.spaceId, id);
  }
}
