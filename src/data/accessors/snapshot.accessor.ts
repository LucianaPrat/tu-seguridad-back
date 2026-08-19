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

  /**
   * Latest snapshot id per camera, for the list response's derived URL. Two
   * queries instead of one per camera: the grid renders every camera in the
   * space at once, and a per-row lookup is the N+1 that shows up as soon as a
   * space owns more than a handful of channels.
   */
  async findLatestIdsByCameraIds(
    spaceId: string,
    cameraIds: string[],
  ): Promise<Map<string, string>> {
    if (cameraIds.length === 0) {
      return new Map();
    }

    const latest = await this.prisma.snapshot.groupBy({
      by: ['cameraId'],
      where: { cameraId: { in: cameraIds }, camera: { dvr: { spaceId } } },
      _max: { capturedAt: true },
    });
    const pairs = latest.flatMap((row) =>
      row._max.capturedAt
        ? [{ cameraId: row.cameraId, capturedAt: row._max.capturedAt }]
        : [],
    );
    if (pairs.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.snapshot.findMany({
      where: { OR: pairs },
      select: { id: true, cameraId: true },
      orderBy: { id: 'asc' },
    });
    return new Map(rows.map((row) => [row.cameraId, row.id]));
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
