import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Append-only activity logs: stream watch minutes, logins, and the read side of both. */
@Injectable()
export class MemberActivityAccessorService {
  constructor(private readonly prisma: PrismaService) {}

  /** One row per minute watched; the composite key makes a repeat a no-op. */
  async recordWatch(
    spaceId: string,
    userId: number,
    cameraId: string,
    minute: Date,
  ): Promise<void> {
    await this.prisma.streamWatchMinute.createMany({
      data: [{ spaceId, userId, cameraId, minute }],
      skipDuplicates: true,
    });
  }

  /**
   * Session starts from `hits`: a user's first hit since `since`, or any hit
   * more than 30 minutes after their previous one (exactly 30 is the same
   * session). Users without a hit never appear.
   */
  async findSessionStarts(
    userIds: number[],
    since: Date,
  ): Promise<{ userId: number; at: Date }[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      { user_id: number; created_at: Date }[]
    >(Prisma.sql`
      SELECT user_id, created_at FROM (
        SELECT user_id, created_at,
          LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS prev
        FROM hits
        WHERE user_id IN (${Prisma.join(userIds)}) AND created_at >= ${since}
      ) t
      WHERE prev IS NULL OR created_at > prev + INTERVAL 30 MINUTE`);
    return rows.map((r) => ({ userId: Number(r.user_id), at: r.created_at }));
  }

  async lastAccess(userIds: number[]): Promise<{ userId: number; at: Date }[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.hit.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _max: { createdAt: true },
    });
    return rows.flatMap((r) =>
      r.userId !== null && r._max.createdAt
        ? [{ userId: r.userId, at: r._max.createdAt }]
        : [],
    );
  }

  findWatchMinutesSince(
    spaceId: string,
    userIds: number[],
    since: Date,
  ): Promise<{ userId: number; cameraId: string; minute: Date }[]> {
    return this.prisma.streamWatchMinute.findMany({
      where: { spaceId, userId: { in: userIds }, minute: { gte: since } },
      select: { userId: true, cameraId: true, minute: true },
    });
  }

  /** Deletes at most `limit` rows, so the first sweep never holds a huge lock. */
  deleteLoginsBefore(before: Date, limit: number): Promise<number> {
    return this.prisma.$executeRaw(
      Prisma.sql`DELETE FROM login_events WHERE created_at < ${before} LIMIT ${limit}`,
    );
  }

  deleteWatchBefore(before: Date, limit: number): Promise<number> {
    return this.prisma.$executeRaw(
      Prisma.sql`DELETE FROM stream_watch_minutes WHERE minute < ${before} LIMIT ${limit}`,
    );
  }
}
