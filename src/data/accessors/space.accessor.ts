import { Injectable } from '@nestjs/common';
import { Prisma, Space, SpaceMember, User } from '@prisma/client';
import { ALERT_ROUTING_DEFAULTS } from '../../cross/common/constants';
import { DEFAULT_MENU_ACCESS } from '../../cross/common/permissions';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateOwnedSpaceInput {
  user: Prisma.UserUncheckedCreateInput;
  spaceName: string;
}

export interface OwnedSpace {
  user: User;
  space: Space;
  member: SpaceMember;
}

@Injectable()
export class SpaceAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.SpaceUncheckedCreateInput): Promise<Space> {
    return this.prisma.space.create({ data });
  }

  findById(spaceId: string): Promise<Space | null> {
    return this.prisma.space.findUnique({ where: { id: spaceId } });
  }

  /**
   * Registration in one transaction: the owner account, its space, its `admin`
   * membership and the space's default routing matrix. Any partial result is a
   * state the login gate rejects — a user with no membership cannot sign in, and
   * a space with no routing rows is a silent alarm.
   */
  createWithOwner(input: CreateOwnedSpaceInput): Promise<OwnedSpace> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: input.user });
      const { space, member } = await this.createSpaceForUser(
        user.id,
        input.spaceName,
        transaction,
      );
      return { user, space, member };
    });
  }

  /**
   * A space, its `admin` membership and its default routing matrix. Callable
   * inside a caller's transaction (registration) or on its own (an existing
   * user adding a space); either way the three rows land together.
   */
  async createSpaceForUser(
    userId: number,
    name: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ space: Space; member: SpaceMember }> {
    if (!tx) {
      return this.prisma.$transaction((transaction) =>
        this.createSpaceForUser(userId, name, transaction),
      );
    }
    const space = await tx.space.create({
      data: { name, createdByUserId: userId },
    });
    const member = await tx.spaceMember.create({
      data: {
        spaceId: space.id,
        userId,
        role: 'admin',
        menuAccess: DEFAULT_MENU_ACCESS.admin,
        cameraIds: [],
      },
    });
    await tx.alertRouting.createMany({
      data: ALERT_ROUTING_DEFAULTS.map((routing) => ({
        spaceId: space.id,
        ...routing,
      })),
      skipDuplicates: true,
    });
    return { space, member };
  }

  rename(spaceId: string, name: string): Promise<Space> {
    return this.prisma.space.update({ where: { id: spaceId }, data: { name } });
  }

  /**
   * Deletes a space that owns no DVR. The caller checks that first: the DVR
   * foreign key is `Restrict`, so a space with one would fail here anyway, but
   * as a driver error instead of a domain answer.
   */
  deleteEmpty(spaceId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await tx.invitation.deleteMany({ where: { spaceId } });
      await tx.alertRouting.deleteMany({ where: { spaceId } });
      await tx.spaceMember.deleteMany({ where: { spaceId } });
      await tx.user.updateMany({
        where: { lastSpaceId: spaceId },
        data: { lastSpaceId: null },
      });
      await tx.space.delete({ where: { id: spaceId } });
    });
  }
}
