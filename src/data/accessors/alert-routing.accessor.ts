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

  listBySpace(spaceId: string): Promise<AlertRouting[]> {
    return this.prisma.alertRouting.findMany({
      where: { spaceId },
      orderBy: [{ alertType: 'asc' }, { channel: 'asc' }],
    });
  }

  /**
   * One transaction because the screen saves the whole matrix with one
   * button, so a half-applied save must not be observable.
   */
  upsertMany(
    spaceId: string,
    cells: readonly {
      alertType: AlertType;
      channel: AlertChannel;
      enabled: boolean;
    }[],
  ): Promise<AlertRouting[]> {
    return this.prisma.$transaction(
      cells.map((cell) =>
        this.prisma.alertRouting.upsert({
          where: {
            spaceId_alertType_channel: {
              spaceId,
              alertType: cell.alertType,
              channel: cell.channel,
            },
          },
          create: {
            spaceId,
            alertType: cell.alertType,
            channel: cell.channel,
            enabled: cell.enabled,
          },
          update: { enabled: cell.enabled },
        }),
      ),
    );
  }
}
