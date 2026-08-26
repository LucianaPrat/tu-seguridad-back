import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../cross/common/constants';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { MemberDto } from './dto/member.dto';
import { MemberListDto } from './dto/member-list.dto';
import { UpdateMemberAlertsDto } from './dto/update-member-alerts.dto';
import { toMemberDto } from './member.mapper';

@Injectable()
export class MembersService {
  constructor(
    private readonly spaceMemberAccessor: SpaceMemberAccessorService,
  ) {}

  async findAll(spaceId: string): Promise<Either<MemberListDto>> {
    const members = await this.spaceMemberAccessor.listBySpace(spaceId);
    const items = members.map(toMemberDto);
    return buildData({ items, total: items.length });
  }

  async setReceiveAlerts(
    spaceId: string,
    userId: number,
    dto: UpdateMemberAlertsDto,
  ): Promise<Either<MemberDto>> {
    const member = await this.spaceMemberAccessor.findBySpaceAndUser(
      spaceId,
      userId,
    );
    if (!member) {
      return buildError(ErrorCode.NOT_FOUND, `Member ${userId} not found`);
    }

    const updated = await this.spaceMemberAccessor.setReceiveAlerts(
      spaceId,
      userId,
      dto.receiveAlerts,
    );
    return buildData(toMemberDto(updated));
  }
}
