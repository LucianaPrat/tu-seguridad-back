import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { AlertRoutingsService } from './alert-routings.service';
import { AlertRoutingListDto } from './dto/alert-routing-list.dto';

@ApiTags('alert-routings')
@Controller('alert-routings')
export class AlertRoutingsController {
  constructor(private readonly alertRoutingsService: AlertRoutingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the alert routing matrix',
    description:
      'The full alert type x channel grid the /channels screen renders, always six ' +
      'cells even for a space that never wrote any of them.',
  })
  @ApiOkResponse({ type: AlertRoutingListDto })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
  })
  findAll(
    @CurrentUser() user: JwtPayload,
  ): Promise<Either<AlertRoutingListDto>> {
    return this.alertRoutingsService.findAll(user.spaceId);
  }

  @Roles(SpaceMemberRole.admin)
  @Put()
  @ApiOperation({
    summary: 'Replace the alert routing matrix',
    description:
      'Admin only. Partial saves are allowed — only the cells sent are written, the ' +
      'rest keep their stored value — and the response is always the full matrix.',
  })
  @ApiOkResponse({ type: AlertRoutingListDto })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
  })
  replace(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AlertRoutingListDto,
  ): Promise<Either<AlertRoutingListDto>> {
    return this.alertRoutingsService.replace(user.spaceId, dto);
  }
}
