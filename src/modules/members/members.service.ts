import { Injectable } from '@nestjs/common';
import { buildData, Either } from '../../cross/errors/either';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { MemberListDto } from './dto/member-list.dto';
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
}
