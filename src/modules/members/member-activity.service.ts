import { Injectable } from '@nestjs/common';
import { buildData, Either } from '../../cross/errors/either';
import { DvrAccessorService } from '../../data/accessors/dvr.accessor';
import { MemberActivityAccessorService } from '../../data/accessors/member-activity.accessor';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import {
  DEFAULT_ACTIVITY_DAYS,
  MemberActivityDto,
} from './dto/member-activity.dto';

const DEFAULT_TIMEZONE = 'America/Montevideo';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `Intl` throws on an unknown zone; a bad DVR value must not break the chart. */
const resolveTimezone = (candidate: string | undefined): string => {
  const tz = candidate || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
};

@Injectable()
export class MemberActivityService {
  constructor(
    private readonly activityAccessor: MemberActivityAccessorService,
    private readonly spaceMemberAccessor: SpaceMemberAccessorService,
    private readonly dvrAccessor: DvrAccessorService,
  ) {}

  /**
   * Accesses are sessions derived from `hits` (see the accessor); days are
   * bucketed in code because the zone is per space and `CONVERT_TZ` needs the
   * server's zone tables loaded. Rows are fetched from a bound two days wider
   * than the two periods and filtered by local day string, which stays right
   * across DST and any UTC offset.
   *
   * ponytail: pulls watch-minute rows for 2x the window (up to 180 days); move
   * to a grouped query if a space ever has heavy streaming.
   */
  async getActivity(
    spaceId: string,
    days: number = DEFAULT_ACTIVITY_DAYS,
    now: Date = new Date(),
  ): Promise<Either<MemberActivityDto>> {
    const [roster, dvr] = await Promise.all([
      this.spaceMemberAccessor.listBySpace(spaceId),
      this.dvrAccessor.findBySpaceId(spaceId),
    ]);
    const timezone = resolveTimezone(dvr?.timezone);
    const userIds = roster.map((m) => m.user.id);
    const dayFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const dayOf = (d: Date) => dayFmt.format(d);

    const today = dayOf(now);
    const [y, m, d] = today.split('-').map(Number);
    const dayAt = (offset: number) =>
      new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
    const period = Array.from({ length: days }, (_, i) => dayAt(i - days + 1));
    const previous = Array.from({ length: days }, (_, i) =>
      dayAt(i - 2 * days + 1),
    );
    const inPeriod = new Set(period);
    const inPrevious = new Set(previous);
    const since = new Date(now.getTime() - (2 * days + 2) * MS_PER_DAY);

    const [starts, lastAccess, watch] = await Promise.all([
      this.activityAccessor.findSessionStarts(userIds, since),
      this.activityAccessor.lastAccess(userIds),
      this.activityAccessor.findWatchMinutesSince(spaceId, userIds, since),
    ]);

    const accesses = new Map<string, number>();
    const prevUsers = new Set<number>();
    let prevSessions = 0;
    for (const { userId, at } of starts) {
      const day = dayOf(at);
      if (inPeriod.has(day)) {
        const k = `${day}|${userId}`;
        accesses.set(k, (accesses.get(k) ?? 0) + 1);
      } else if (inPrevious.has(day)) {
        prevSessions++;
        prevUsers.add(userId);
      }
    }

    const byDay = new Map<string, number>();
    const byUserCamera = new Map<string, number>();
    let prevWatch = 0;
    for (const { userId, cameraId, minute } of watch) {
      const day = dayOf(minute);
      if (inPeriod.has(day)) {
        const a = `${day}|${cameraId}`;
        byDay.set(a, (byDay.get(a) ?? 0) + 1);
        const b = `${userId}|${cameraId}`;
        byUserCamera.set(b, (byUserCamera.get(b) ?? 0) + 1);
      } else if (inPrevious.has(day)) {
        prevWatch++;
      }
    }

    return buildData({
      timezone,
      days: period,
      accessesByDay: [...accesses].map(([k, sessions]) => {
        const [date, u] = k.split('|');
        return { date, userId: Number(u), sessions };
      }),
      watchByDay: [...byDay].map(([k, minutes]) => {
        const [date, cameraId] = k.split('|');
        return { date, cameraId, minutes };
      }),
      watchByUserCamera: [...byUserCamera].map(([k, minutes]) => {
        const [u, cameraId] = k.split('|');
        return { userId: Number(u), cameraId, minutes };
      }),
      lastAccess: lastAccess.map((r) => ({
        userId: r.userId,
        at: r.at.toISOString(),
      })),
      previous: {
        sessions: prevSessions,
        activeUsers: prevUsers.size,
        watchMinutes: prevWatch,
      },
    });
  }
}
