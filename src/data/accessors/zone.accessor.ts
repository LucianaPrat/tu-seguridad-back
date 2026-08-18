import { Injectable } from '@nestjs/common';
import { MonitorZone, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MonitorZoneAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  findByCamera(spaceId: string, cameraId: string): Promise<MonitorZone[]> {
    return this.prisma.monitorZone.findMany({
      where: {
        cameraId,
        deletedAt: null,
        camera: { dvr: { spaceId }, deletedAt: null },
      },
      orderBy: { id: 'asc' },
    });
  }

  findById(spaceId: string, id: string): Promise<MonitorZone | null> {
    return this.prisma.monitorZone.findFirst({
      where: {
        id,
        deletedAt: null,
        camera: { dvr: { spaceId }, deletedAt: null },
      },
    });
  }

  async create(
    spaceId: string,
    data: Prisma.MonitorZoneUncheckedCreateInput,
  ): Promise<MonitorZone | null> {
    const camera = await this.prisma.camera.findFirst({
      where: { id: data.cameraId, deletedAt: null, dvr: { spaceId } },
      select: { id: true },
    });
    if (!camera) {
      return null;
    }
    return this.prisma.monitorZone.create({ data });
  }

  async update(
    spaceId: string,
    id: string,
    data: Prisma.MonitorZoneUpdateManyMutationInput,
  ): Promise<MonitorZone | null> {
    const result = await this.prisma.monitorZone.updateMany({
      where: {
        id,
        deletedAt: null,
        camera: { dvr: { spaceId }, deletedAt: null },
      },
      data,
    });
    return result.count === 1 ? this.findById(spaceId, id) : null;
  }

  async softDelete(spaceId: string, id: string): Promise<boolean> {
    const result = await this.prisma.monitorZone.updateMany({
      where: {
        id,
        deletedAt: null,
        camera: { dvr: { spaceId }, deletedAt: null },
      },
      data: { deletedAt: new Date() },
    });
    return result.count === 1;
  }
}
