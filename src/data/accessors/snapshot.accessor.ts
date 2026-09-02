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

  /**
   * The camera's live frame: one row per camera, rewritten in place on every
   * successful poll. In place rather than a fresh row per tick because the row
   * count has to stay bounded whatever the retention window is, and separate
   * from evidence rows because an alert's
   * frame must still show what the alert saw a week later.
   */
  async upsertLive(
    spaceId: string,
    data: Prisma.SnapshotUncheckedCreateInput,
  ): Promise<Snapshot | null> {
    const live = await this.prisma.snapshot.findFirst({
      where: {
        cameraId: data.cameraId,
        isLive: true,
        camera: { deletedAt: null, dvr: { spaceId } },
      },
      select: { id: true },
    });
    if (!live) {
      return this.create(spaceId, { ...data, isLive: true });
    }
    return this.prisma.snapshot.update({
      where: { id: live.id },
      data: { ...data, isLive: true },
    });
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

  /**
   * Retention sweep, and the only thing in this repo that deletes a snapshot.
   * Evidence frames only: `isLive` rows are one per camera, rewritten in place,
   * and a camera whose thumbnail was swept would show a hole in the grid.
   *
   * An `AlertEvent` still pointing at a swept frame keeps its row and loses its
   * `snapshotId` — the FK is `SetNull`, and that is the intended outcome rather
   * than an accident: the event is the record of what happened, the frame is
   * evidence with a shelf life. The event's copied `cameraLabel`, alert type and
   * detection metrics are what make the history readable after the bytes go.
   *
   * No "is it still referenced" clause: events and their frames age together, so
   * a frame past the window is only ever referenced by an event past it too.
   */
  async deleteEvidenceBefore(before: Date, limit: number): Promise<number> {
    const doomed = await this.prisma.snapshot.findMany({
      where: { isLive: false, capturedAt: { lt: before } },
      select: { id: true },
      take: limit,
    });
    if (doomed.length === 0) {
      return 0;
    }
    const { count } = await this.prisma.snapshot.deleteMany({
      where: { id: { in: doomed.map((row) => row.id) } },
    });
    return count;
  }
}
