import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { ErrorCode } from '../../cross/common/constants';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { MemberDto } from './dto/member.dto';
import { MemberListDto } from './dto/member-list.dto';
import { UpdateMemberAlertsDto } from './dto/update-member-alerts.dto';
import { MembersService } from './members.service';

@ApiTags('members')
@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @ApiOperation({
    summary: 'List the members of the space',
    description:
      'Every member of the caller space, inactive ones included — the screen renders ' +
      'the state as a badge. Each row carries `receiveAlerts`, the per-member alert ' +
      'opt-in the channels screen toggles.',
  })
  @ApiOkResponse({ type: MemberListDto })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
  })
  findAll(@CurrentUser() user: JwtPayload): Promise<Either<MemberListDto>> {
    return this.membersService.findAll(user.spaceId);
  }

  @Roles(SpaceMemberRole.admin)
  @Patch(':userId')
  @ApiOperation({
    summary: 'Set whether a member receives the space alerts',
    description:
      'Admin only. The id is the user id the roster returns; the member itself is ' +
      'untouched otherwise.',
  })
  @ApiOkResponse({ type: MemberDto, description: 'Member after the update.' })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Malformed body, or a non-numeric id.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
    [ErrorCode.NOT_FOUND]: 'No such member in the caller space.',
  })
  setReceiveAlerts(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateMemberAlertsDto,
  ): Promise<Either<MemberDto>> {
    return this.membersService.setReceiveAlerts(user.spaceId, userId, dto);
  }
}
