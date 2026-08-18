import { Injectable } from '@nestjs/common';
import { Prisma, Space, SpaceMember, User } from '@prisma/client';
import { ALERT_ROUTING_DEFAULTS } from '../../cross/common/constants';
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

  findByOwnerUserId(userId: number): Promise<Space | null> {
    return this.prisma.space.findUnique({ where: { ownerUserId: userId } });
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
      const space = await transaction.space.create({
        data: { name: input.spaceName, ownerUserId: user.id },
      });
      const member = await transaction.spaceMember.create({
        data: { spaceId: space.id, userId: user.id, role: 'admin' },
      });
      await transaction.alertRouting.createMany({
        data: ALERT_ROUTING_DEFAULTS.map((routing) => ({
          spaceId: space.id,
          ...routing,
        })),
        skipDuplicates: true,
      });
      return { user, space, member };
    });
  }
}
