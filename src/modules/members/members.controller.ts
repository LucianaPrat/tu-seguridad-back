import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SpaceMemberRole } from '@prisma/client';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { ErrorCode } from '../../cross/common/constants';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { RequireMenu } from '../../cross/decorators/require-menu.decorator';
import { Roles } from '../../cross/decorators/roles.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { CreateMemberDto } from './dto/create-member.dto';
import {
  MemberActivityDto,
  QueryMemberActivityDto,
} from './dto/member-activity.dto';
import { MemberActivityService } from './member-activity.service';
import { MemberDto } from './dto/member.dto';
import { MemberListDto } from './dto/member-list.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MembersService } from './members.service';

@ApiTags('members')
@Controller('members')
export class MembersController {
  constructor(
    private readonly membersService: MembersService,
    private readonly memberActivityService: MemberActivityService,
  ) {}

  @RequireMenu('members')
  @Get()
  @ApiOperation({
    summary: 'List the members of the space',
    description:
      'Every member of the caller space, inactive ones included — the screen renders ' +
      'the state as a badge. Each row carries `receiveAlerts`, the per-member alert ' +
      'opt-in, and `role` always; `menuAccess`/`cameraIds` only for an admin caller.',
  })
  @ApiOkResponse({ type: MemberListDto })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller lacks the members section, or has an incomplete profile.',
  })
  findAll(@CurrentUser() user: JwtPayload): Promise<Either<MemberListDto>> {
    return this.membersService.findAll(
      user.spaceId,
      user.role === SpaceMemberRole.admin,
    );
  }

  // Declared before any `:param` route so a literal path is never read as an id.
  @Roles(SpaceMemberRole.admin)
  @Get('activity')
  @ApiOperation({
    summary: 'Access and live-stream activity of the space members',
    description:
      'Admin only. An access is a session of authenticated API requests (a new one ' +
      'starts after 30 idle minutes), so saved-token users count. Covers the last ' +
      '`days` calendar days (7, 30 or 90; default 30) ending today in the space DVR ' +
      'timezone, plus totals for the `days` before for deltas. `lastAccess` is all ' +
      'time. Only current members are counted.',
  })
  @ApiOkResponse({ type: MemberActivityDto })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: '`days` is not 7, 30 or 90.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
  })
  activity(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryMemberActivityDto,
  ): Promise<Either<MemberActivityDto>> {
    return this.memberActivityService.getActivity(user.spaceId, query.days);
  }

  @Roles(SpaceMemberRole.admin)
  @Post()
  @ApiOperation({
    summary: 'Add a member directly, with no invitation or email',
    description:
      'Admin only. An email with an account only gains the membership; its password ' +
      'and profile are left alone. A new email needs firstName, lastName, phone and ' +
      'password (400 otherwise) and gets a ready-to-use account.',
  })
  @ApiCreatedResponse({ type: MemberDto, description: 'The created member.' })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Malformed body, cameraIds outside this space, or profile fields missing for a new user.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
    [ErrorCode.CONFLICT]:
      'Already a member of the space, or an invitation for the email is pending.',
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMemberDto,
  ): Promise<Either<MemberDto>> {
    return this.membersService.create(user.spaceId, user.sub, dto);
  }

  @Roles(SpaceMemberRole.admin)
  @Patch(':userId')
  @ApiOperation({
    summary: 'Update a member: role, menu, cameras, alert opt-in',
    description:
      'Admin only. The id is the user id the roster returns. Every field is optional. ' +
      'An admin cannot change their own role (409); the same role is a no-op. ' +
      'firstName, lastName, phone and email are only accepted while `profileEditable` ' +
      '(the user belongs to this space alone, 403 otherwise); a new email revokes all ' +
      'the user sessions.',
  })
  @ApiOkResponse({ type: MemberDto, description: 'Member after the update.' })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]:
      'Malformed body, a non-numeric id, or cameraIds outside this space.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, has an incomplete profile, or profile fields were sent for a member of other spaces.',
    [ErrorCode.NOT_FOUND]: 'No such member in the caller space.',
    [ErrorCode.CONFLICT]:
      'An admin tried to change their own role, or the email belongs to another user.',
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateMemberDto,
  ): Promise<Either<MemberDto>> {
    return this.membersService.update(user.spaceId, user.sub, userId, dto);
  }

  @Roles(SpaceMemberRole.admin)
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a member from the space',
    description:
      "Admin only. Clears the user's last space if it pointed here; their next " +
      'request in this space answers 403.',
  })
  @ApiNoContentResponse({ description: 'Member removed. Empty body.' })
  @ApiFailures({
    [ErrorCode.VALIDATION_ERROR]: 'Non-numeric id.',
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]:
      'Caller is not a space admin, or has an incomplete profile.',
    [ErrorCode.NOT_FOUND]: 'No such member in the caller space.',
    [ErrorCode.CONFLICT]: 'An admin tried to remove themselves.',
  })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<Either<null>> {
    return this.membersService.remove(user.spaceId, user.sub, userId);
  }
}
