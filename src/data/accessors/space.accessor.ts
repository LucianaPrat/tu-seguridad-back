import { Injectable } from '@nestjs/common';
import { Prisma, Space } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
}
