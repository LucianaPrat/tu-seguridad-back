import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { ErrorCode } from '../../cross/common/constants';
import { CurrentUser } from '../../cross/decorators/current-user.decorator';
import { ApiFailures } from '../../cross/errors/api-failures.decorator';
import { Either } from '../../cross/errors/either';
import { MemberListDto } from './dto/member-list.dto';
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
      'the state as a badge.',
  })
  @ApiOkResponse({ type: MemberListDto })
  @ApiFailures({
    [ErrorCode.UNAUTHORIZED]: 'Missing or invalid bearer token.',
    [ErrorCode.FORBIDDEN]: 'Caller has not completed their profile.',
  })
  findAll(@CurrentUser() user: JwtPayload): Promise<Either<MemberListDto>> {
    return this.membersService.findAll(user.spaceId);
  }
}
