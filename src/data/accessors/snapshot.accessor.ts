import { Injectable } from '@nestjs/common';
import { Prisma, Snapshot } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SnapshotAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    spaceId: string,
    data: Prisma.SnapshotUncheckedCreateInput,
  ): Promise<Snapshot | null> {
    const camera = await this.prisma.camera.findFirst({
      where: { id: data.cameraId, deletedAt: null, dvr: { spaceId } },
      select: { id: true },
    });
    if (!camera) {
      return null;
    }
    return this.prisma.snapshot.create({ data });
  }

  findLatestByCamera(
    spaceId: string,
    cameraId: string,
  ): Promise<Snapshot | null> {
    return this.prisma.snapshot.findFirst({
      where: {
        cameraId,
        camera: { deletedAt: null, dvr: { spaceId } },
      },
      orderBy: { capturedAt: 'desc' },
    });
  }

  findById(spaceId: string, snapshotId: string): Promise<Snapshot | null> {
    return this.prisma.snapshot.findFirst({
      where: { id: snapshotId, camera: { dvr: { spaceId } } },
    });
  }

  findForAlertEvent(
    spaceId: string,
    snapshotId: string,
  ): Promise<Snapshot | null> {
    return this.prisma.snapshot.findFirst({
      where: {
        id: snapshotId,
        alertEvents: { some: { spaceId } },
      },
    });
  }
}
