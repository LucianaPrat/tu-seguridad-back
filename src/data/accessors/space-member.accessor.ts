import { Injectable } from '@nestjs/common';
import { Prisma, SpaceMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Only the columns the roster renders. `include: { user: true }` would hand the
// module layer every member's `passwordHash`.
const ROSTER_SELECT = {
  receiveAlerts: true,
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
  user: { select: { email: true, firstName: true } },
} as const;

export type AlertRecipientRecord = Prisma.SpaceMemberGetPayload<{
  select: typeof ALERT_RECIPIENT_SELECT;
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

  findActiveRecipients(spaceId: string): Promise<AlertRecipientRecord[]> {
    return this.prisma.spaceMember.findMany({
      where: { spaceId, receiveAlerts: true, user: { isActive: true } },
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

  setReceiveAlerts(
    spaceId: string,
    userId: number,
    receiveAlerts: boolean,
  ): Promise<SpaceMemberRosterRecord> {
    return this.prisma.spaceMember.update({
      where: { spaceId_userId: { spaceId, userId } },
      data: { receiveAlerts },
      select: ROSTER_SELECT,
    });
  }
}
