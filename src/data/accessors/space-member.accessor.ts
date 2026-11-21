import { Injectable } from '@nestjs/common';
import { Prisma, SpaceMember, SpaceMemberRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Only the columns the roster renders. `include: { user: true }` would hand the
// module layer every member's `passwordHash`.
const ROSTER_SELECT = {
  receiveAlerts: true,
  role: true,
  menuAccess: true,
  cameraIds: true,
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

// Who an alert actually goes to. Separate from ROSTER_SELECT because a delivery
// needs the address and the first name and nothing else — the roster's badges
// are not a notification's business.
const ALERT_RECIPIENT_SELECT = {
  userId: true,
  user: { select: { email: true, firstName: true, locale: true } },
} as const;

export type AlertRecipientRecord = Prisma.SpaceMemberGetPayload<{
  select: typeof ALERT_RECIPIENT_SELECT;
}>;

export type MemberWithSpaceRecord = Prisma.SpaceMemberGetPayload<{
  include: { space: { select: { id: true; name: true } } };
}>;

@Injectable()
export class SpaceMemberAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.SpaceMemberUncheckedCreateInput): Promise<SpaceMember> {
    return this.prisma.spaceMember.create({ data });
  }

  findLatestByUserId(userId: number): Promise<SpaceMember | null> {
    return this.prisma.spaceMember.findFirst({
      where: { userId },
      orderBy: { joinedAt: 'desc' },
    });
  }

  findBySpaceAndUser(
    spaceId: string,
    userId: number,
  ): Promise<SpaceMember | null> {
    return this.prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId } },
    });
  }

  findManyByUserIdWithSpace(userId: number): Promise<MemberWithSpaceRecord[]> {
    return this.prisma.spaceMember.findMany({
      where: { userId },
      include: { space: { select: { id: true, name: true } } },
      orderBy: { space: { name: 'asc' } },
    });
  }

  findActiveRecipients(
    spaceId: string,
    cameraId: string | null,
  ): Promise<AlertRecipientRecord[]> {
    return this.prisma.spaceMember.findMany({
      where: {
        spaceId,
        receiveAlerts: true,
        user: { isActive: true },
        // A guest only hears about its own cameras; an event with no camera reaches no guest.
        OR: [
          { role: { not: SpaceMemberRole.guest } },
          ...(cameraId ? [{ cameraIds: { array_contains: [cameraId] } }] : []),
        ],
      },
      select: ALERT_RECIPIENT_SELECT,
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

  update(
    spaceId: string,
    userId: number,
    data: Prisma.SpaceMemberUpdateInput,
  ): Promise<SpaceMemberRosterRecord> {
    return this.prisma.spaceMember.update({
      where: { spaceId_userId: { spaceId, userId } },
      data,
      select: ROSTER_SELECT,
    });
  }

  /** Drops the membership and forgets it as the user's last space, together. */
  async remove(spaceId: string, userId: number): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.spaceMember.deleteMany({ where: { spaceId, userId } }),
      this.prisma.user.updateMany({
        where: { id: userId, lastSpaceId: spaceId },
        data: { lastSpaceId: null },
      }),
    ]);
  }
}
