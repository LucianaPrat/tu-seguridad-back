import { Injectable } from '@nestjs/common';
import { Prisma, Zone } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ZoneAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  findByCamera(cameraId: string): Promise<Zone[]> {
    return this.prisma.zone.findMany({
      where: { cameraId },
      orderBy: { id: 'asc' },
    });
  }

  findById(id: string): Promise<Zone | null> {
    return this.prisma.zone.findUnique({ where: { id } });
  }

  create(data: Prisma.ZoneUncheckedCreateInput): Promise<Zone> {
    return this.prisma.zone.create({ data });
  }

  update(id: string, data: Prisma.ZoneUncheckedUpdateInput): Promise<Zone> {
    return this.prisma.zone.update({ where: { id }, data });
  }

  delete(id: string): Promise<Zone> {
    return this.prisma.zone.delete({ where: { id } });
  }
}
