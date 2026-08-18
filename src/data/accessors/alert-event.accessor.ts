import { Injectable } from '@nestjs/common';
import { AlertEvent, AlertType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AlertEventQuery {
  alertType?: AlertType;
  from?: Date;
  to?: Date;
  take?: number;
}

export type CreateAlertEventInput = Omit<
  Prisma.AlertEventUncheckedCreateInput,
  'spaceId'
>;

@Injectable()
export class AlertEventAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    spaceId: string,
    data: CreateAlertEventInput,
  ): Promise<AlertEvent | null> {
    const [camera, zone, snapshot] = await Promise.all([
      data.cameraId
        ? this.prisma.camera.findFirst({
            where: { id: data.cameraId, dvr: { spaceId } },
            select: { id: true },
          })
        : Promise.resolve(null),
      data.zoneId
        ? this.prisma.monitorZone.findFirst({
            where: { id: data.zoneId, camera: { dvr: { spaceId } } },
            select: { id: true },
          })
        : Promise.resolve(null),
      data.snapshotId
        ? this.prisma.snapshot.findFirst({
            where: { id: data.snapshotId, camera: { dvr: { spaceId } } },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (
      (data.cameraId && !camera) ||
      (data.zoneId && !zone) ||
      (data.snapshotId && !snapshot)
    ) {
      return null;
    }
    return this.prisma.alertEvent.create({ data: { ...data, spaceId } });
  }

  findById(spaceId: string, eventId: string): Promise<AlertEvent | null> {
    return this.prisma.alertEvent.findFirst({
      where: { id: eventId, spaceId },
    });
  }

  query(spaceId: string, query: AlertEventQuery): Promise<AlertEvent[]> {
    const where: Prisma.AlertEventWhereInput = { spaceId };
    if (query.alertType) {
      where.alertType = query.alertType;
    }
    if (query.from || query.to) {
      where.detectedAt = { gte: query.from, lte: query.to };
    }
    return this.prisma.alertEvent.findMany({
      where,
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: query.take,
    });
  }
}
