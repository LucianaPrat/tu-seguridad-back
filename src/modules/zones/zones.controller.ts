import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Either } from '../../cross/errors/either';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ValidatePolygonResultDto } from './dto/validate-polygon-result.dto';
import { ValidateZoneDto } from './dto/validate-zone.dto';
import { ZoneDto } from './dto/zone.dto';
import { ZonesService } from './zones.service';

@ApiTags('zones')
@ApiBearerAuth()
@Controller()
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Get('cameras/:cameraId/zones')
  findByCamera(
    @Param('cameraId') cameraId: string,
  ): Promise<Either<ZoneDto[]>> {
    return this.zonesService.findByCamera(cameraId);
  }

  @Post('cameras/:cameraId/zones')
  create(
    @Param('cameraId') cameraId: string,
    @Body() dto: CreateZoneDto,
  ): Promise<Either<ZoneDto>> {
    return this.zonesService.create(cameraId, dto);
  }

  @Get('zones/:id')
  findOne(@Param('id') id: string): Promise<Either<ZoneDto>> {
    return this.zonesService.findById(id);
  }

  @Put('zones/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateZoneDto,
  ): Promise<Either<ZoneDto>> {
    return this.zonesService.update(id, dto);
  }

  @Delete('zones/:id')
  remove(@Param('id') id: string): Promise<Either<null>> {
    return this.zonesService.delete(id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('zones/:id/validate')
  validate(
    @Param('id') id: string,
    @Body() dto: ValidateZoneDto,
  ): Promise<Either<ValidatePolygonResultDto>> {
    return this.zonesService.validate(id, dto.polygon);
  }
}
