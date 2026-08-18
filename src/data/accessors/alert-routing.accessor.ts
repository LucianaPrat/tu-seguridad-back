import { Injectable } from '@nestjs/common';
import { AlertChannel, AlertRouting, AlertType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AlertRoutingAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  findEnabled(spaceId: string, alertType: AlertType): Promise<AlertRouting[]> {
    return this.prisma.alertRouting.findMany({
      where: { spaceId, alertType, enabled: true },
      orderBy: { channel: 'asc' },
    });
  }

  upsert(
    spaceId: string,
    alertType: AlertType,
    channel: AlertChannel,
    enabled: boolean,
  ): Promise<AlertRouting> {
    return this.prisma.alertRouting.upsert({
      where: { spaceId_alertType_channel: { spaceId, alertType, channel } },
      create: { spaceId, alertType, channel, enabled },
      update: { enabled },
    });
  }
}
