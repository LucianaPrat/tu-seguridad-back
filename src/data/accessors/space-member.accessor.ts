import { Injectable } from '@nestjs/common';
import { Prisma, SpaceMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
}
