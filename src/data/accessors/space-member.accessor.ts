import { Injectable } from '@nestjs/common';
import { Prisma, SpaceMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Only the columns the roster renders. `include: { user: true }` would hand the
// module layer every member's `passwordHash`.
const ROSTER_SELECT = {
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatarUrl: true,
      isActive: true,
      lastLoginAt: true,
      profileCompleted: true,
    },
  },
} as const;

export type SpaceMemberRosterRecord = Prisma.SpaceMemberGetPayload<{
  select: typeof ROSTER_SELECT;
}>;

@Injectable()
export class SpaceMemberAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.SpaceMemberUncheckedCreateInput): Promise<SpaceMember> {
    return this.prisma.spaceMember.create({ data });
  }

  findByUserId(userId: number): Promise<SpaceMember | null> {
    return this.prisma.spaceMember.findUnique({ where: { userId } });
  }

  findBySpaceAndUser(
    spaceId: string,
    userId: number,
  ): Promise<SpaceMember | null> {
    return this.prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId } },
    });
  }

  findActiveRecipients(spaceId: string): Promise<SpaceMember[]> {
    return this.prisma.spaceMember.findMany({
      where: { spaceId, receiveAlerts: true, user: { isActive: true } },
      orderBy: { userId: 'asc' },
    });
  }

  // Unlike findActiveRecipients, this list feeds the Members screen, whose
  // whole point is the active/inactive badge — inactive users must stay in.
  listBySpace(spaceId: string): Promise<SpaceMemberRosterRecord[]> {
    return this.prisma.spaceMember.findMany({
      where: { spaceId },
      select: ROSTER_SELECT,
      orderBy: { joinedAt: 'asc' },
    });
  }
}
