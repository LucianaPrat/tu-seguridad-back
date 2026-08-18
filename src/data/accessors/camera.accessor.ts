import { Injectable } from '@nestjs/common';
import { Camera, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CameraAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(spaceId: string): Promise<Camera[]> {
    return this.prisma.camera.findMany({
      where: { dvr: { spaceId }, deletedAt: null },
      orderBy: { id: 'asc' },
    });
  }

  findById(spaceId: string, id: string): Promise<Camera | null> {
    return this.prisma.camera.findFirst({
      where: { id, deletedAt: null, dvr: { spaceId } },
    });
  }

  async create(
    spaceId: string,
    data: Prisma.CameraUncheckedCreateInput,
  ): Promise<Camera | null> {
    const dvr = await this.prisma.dvr.findFirst({
      where: { id: data.dvrId, spaceId },
      select: { id: true },
    });
    if (!dvr) {
      return null;
    }
    return this.prisma.camera.create({ data });
  }

  async update(
    spaceId: string,
    id: string,
    data: Prisma.CameraUpdateManyMutationInput,
  ): Promise<Camera | null> {
    const result = await this.prisma.camera.updateMany({
      where: { id, deletedAt: null, dvr: { spaceId } },
      data,
    });
    return result.count === 1 ? this.findById(spaceId, id) : null;
  }

  async softDelete(spaceId: string, id: string): Promise<boolean> {
    const result = await this.prisma.camera.updateMany({
      where: { id, deletedAt: null, dvr: { spaceId } },
      data: { deletedAt: new Date(), isConfigured: false },
    });
    return result.count === 1;
  }

  findPollableBySpace(spaceId: string): Promise<Camera[]> {
    return this.prisma.camera.findMany({
      where: {
        dvr: { spaceId },
        deletedAt: null,
        isConfigured: true,
        isEnabled: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  countMonitorZones(spaceId: string, cameraId: string): Promise<number> {
    return this.prisma.monitorZone.count({
      where: {
        cameraId,
        deletedAt: null,
        camera: { dvr: { spaceId }, deletedAt: null },
      },
    });
  }
}
