import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { Either } from '../../cross/errors/either';
import { ConfigureDvrDto } from './dto/configure-dvr.dto';
import { DvrDto } from './dto/dvr.dto';
import { DvrService } from './dvr.service';

@ApiTags('dvr')
@ApiBearerAuth()
@Controller('dvr')
export class DvrController {
  constructor(private readonly dvrService: DvrService) {}

  /** Any member may see which recorder the space watches; only an admin may change it. */
  @Get()
  @ApiOkResponse({ type: DvrDto })
  findOne(@CurrentUser() user: JwtPayload): Promise<Either<DvrDto>> {
    return this.dvrService.findBySpace(user.spaceId);
  }

  @Roles(SpaceMemberRole.admin)
  @Put()
  @ApiOkResponse({ type: DvrDto })
  configure(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfigureDvrDto,
  ): Promise<Either<DvrDto>> {
    return this.dvrService.configure(user.spaceId, dto);
  }

  @Roles(SpaceMemberRole.admin)
  @HttpCode(HttpStatus.OK)
  @Post('discovery')
  @ApiOkResponse({ type: DvrDto })
  rediscover(@CurrentUser() user: JwtPayload): Promise<Either<DvrDto>> {
    return this.dvrService.rediscover(user.spaceId);
  }
}
