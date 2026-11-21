import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { DEFAULT_MENU_ACCESS } from '../../cross/common/permissions';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { MemberDto } from './dto/member.dto';
import { MemberListDto } from './dto/member-list.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { toMemberDto } from './member.mapper';

const SELF_ROLE_CHANGE_MESSAGE = 'An admin cannot change their own role';
const SELF_REMOVAL_MESSAGE = 'You cannot remove yourself from the space';

@Injectable()
export class MembersService {
  constructor(
    private readonly spaceMemberAccessor: SpaceMemberAccessorService,
    private readonly cameraAccessor: CameraAccessorService,
  ) {}

  async findAll(
    spaceId: string,
    withPermissions: boolean,
  ): Promise<Either<MemberListDto>> {
    const members = await this.spaceMemberAccessor.listBySpace(spaceId);
    const items = members.map((m) => toMemberDto(m, withPermissions));
    return buildData({ items, total: items.length });
  }

  async update(
    spaceId: string,
    callerUserId: number,
    userId: number,
    dto: UpdateMemberDto,
  ): Promise<Either<MemberDto>> {
    const member = await this.spaceMemberAccessor.findBySpaceAndUser(
      spaceId,
      userId,
    );
    if (!member) {
      return buildError(ErrorCode.NOT_FOUND, `Member ${userId} not found`);
    }

    const newRole = dto.role ?? member.role;
    const roleChanged = newRole !== member.role;
    // ponytail: no admin count. Admins cannot act on their own role or membership, so the
    // last admin is unreachable except by two admins demoting each other concurrently —
    // add a row-locked count if that ever matters.
    if (roleChanged && userId === callerUserId) {
      return buildError(ErrorCode.CONFLICT, SELF_ROLE_CHANGE_MESSAGE);
    }

    if (dto.cameraIds?.length) {
      const owned = await this.cameraAccessor.findAll(spaceId, dto.cameraIds);
      if (owned.length !== dto.cameraIds.length) {
        return buildError(
          ErrorCode.VALIDATION_ERROR,
          'cameraIds must belong to cameras of this space',
        );
      }
    }

    const data: Prisma.SpaceMemberUpdateInput = {};
    if (roleChanged) data.role = newRole;
    if (dto.menuAccess !== undefined) data.menuAccess = dto.menuAccess;
    else if (roleChanged) data.menuAccess = DEFAULT_MENU_ACCESS[newRole];
    if (dto.cameraIds !== undefined) data.cameraIds = dto.cameraIds;
    if (dto.receiveAlerts !== undefined) data.receiveAlerts = dto.receiveAlerts;

    const updated = await this.spaceMemberAccessor.update(
      spaceId,
      userId,
      data,
    );
    return buildData(toMemberDto(updated, true));
  }

  async remove(
    spaceId: string,
    callerUserId: number,
    userId: number,
  ): Promise<Either<null>> {
    if (userId === callerUserId) {
      return buildError(ErrorCode.CONFLICT, SELF_REMOVAL_MESSAGE);
    }
    const member = await this.spaceMemberAccessor.findBySpaceAndUser(
      spaceId,
      userId,
    );
    if (!member) {
      return buildError(ErrorCode.NOT_FOUND, `Member ${userId} not found`);
    }
    await this.spaceMemberAccessor.remove(spaceId, userId);
    return buildData(null);
  }
}
