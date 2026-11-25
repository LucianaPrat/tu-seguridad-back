import { Injectable } from '@nestjs/common';
import { Prisma, SpaceMemberRole } from '@prisma/client';
import { ErrorCode } from '../../cross/common/constants';
import { normalizeEmail } from '../../cross/common/normalize-email';
import { DEFAULT_MENU_ACCESS } from '../../cross/common/permissions';
import { buildData, buildError, Either } from '../../cross/errors/either';
import { PasswordHashService } from '../../cross/crypto/password-hash.service';
import { CameraAccessorService } from '../../data/accessors/camera.accessor';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { InvitationAccessorService } from '../../data/accessors/invitation.accessor';
import { UserAccessorService } from '../../data/accessors/user.accessor';
import { CreateMemberDto } from './dto/create-member.dto';
import { MemberDto } from './dto/member.dto';
import { MemberListDto } from './dto/member-list.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { toMemberDto } from './member.mapper';

const UNIQUE_CONSTRAINT_ERROR = 'P2002';
const SELF_ROLE_CHANGE_MESSAGE = 'An admin cannot change their own role';
const SELF_REMOVAL_MESSAGE = 'You cannot remove yourself from the space';

@Injectable()
export class MembersService {
  constructor(
    private readonly spaceMemberAccessor: SpaceMemberAccessorService,
    private readonly cameraAccessor: CameraAccessorService,
    private readonly userAccessor: UserAccessorService,
    private readonly invitationAccessor: InvitationAccessorService,
    private readonly passwordHash: PasswordHashService,
  ) {}

  /**
   * Admin adds an account straight to the space, no invitation or mail. An
   * existing account only gains the membership — its password and profile are
   * never touched; a new one needs the full profile and is created ready to
   * log in (profile complete, so no completion gate).
   */
  async create(
    spaceId: string,
    adminUserId: number,
    dto: CreateMemberDto,
  ): Promise<Either<MemberDto>> {
    const email = normalizeEmail(dto.email);

    const existing = await this.userAccessor.findByEmail(email);
    if (
      existing &&
      (await this.spaceMemberAccessor.findBySpaceAndUser(spaceId, existing.id))
    ) {
      return buildError(
        ErrorCode.CONFLICT,
        'This user is already a member of the space',
      );
    }
    if (
      await this.invitationAccessor.findPendingBySpaceAndEmail(spaceId, email)
    ) {
      return buildError(
        ErrorCode.CONFLICT,
        'An invitation for this email is already pending',
      );
    }

    const cameraIds = dto.cameraIds ?? [];
    if (cameraIds.length > 0) {
      const owned = await this.cameraAccessor.findAll(spaceId, cameraIds);
      if (owned.length !== cameraIds.length) {
        return buildError(
          ErrorCode.VALIDATION_ERROR,
          'cameraIds must belong to cameras of this space',
        );
      }
    }

    const { firstName, lastName, phone, password } = dto;
    if (!existing && !(firstName && lastName && phone && password)) {
      return buildError(
        ErrorCode.VALIDATION_ERROR,
        'firstName, lastName, phone and password are required for a new user',
      );
    }

    const member = {
      spaceId,
      role: dto.role,
      menuAccess: dto.menuAccess ?? DEFAULT_MENU_ACCESS[dto.role],
      cameraIds,
      invitedByUserId: adminUserId,
      receiveAlerts: dto.role !== SpaceMemberRole.guest,
    };
    try {
      let userId: number;
      if (existing) {
        userId = existing.id;
        await this.spaceMemberAccessor.create({ ...member, userId });
      } else {
        userId = (
          await this.spaceMemberAccessor.createUserWithMembership(
            {
              email,
              passwordHash: await this.passwordHash.hash(password!),
              firstName: firstName!,
              lastName: lastName!,
              phone: phone!,
              isActive: true,
              profileCompleted: true,
              lastSpaceId: spaceId,
              locale:
                dto.locale ??
                (await this.userAccessor.findById(adminUserId))?.locale,
            },
            member,
          )
        ).id;
      }
      const created = await this.spaceMemberAccessor.findRoster(
        spaceId,
        userId,
      );
      return buildData(toMemberDto(created!, true));
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_ERROR
      ) {
        return buildError(
          ErrorCode.CONFLICT,
          'This user is already a member of the space',
        );
      }
      throw error;
    }
  }

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
