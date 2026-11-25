import { MemberActivityService } from './member-activity.service';

// 12:00Z is 09:00 in Montevideo (UTC-3): today = 2026-09-15.
const NOW = new Date('2026-09-15T12:00:00Z');

describe('MemberActivityService', () => {
  let activity: {
    findSessionStarts: jest.Mock;
    lastAccess: jest.Mock;
    findWatchMinutesSince: jest.Mock;
  };
  let members: { listBySpace: jest.Mock };
  let dvr: { findBySpaceId: jest.Mock };
  let service: MemberActivityService;

  beforeEach(() => {
    activity = {
      findSessionStarts: jest.fn().mockResolvedValue([]),
      lastAccess: jest.fn().mockResolvedValue([]),
      findWatchMinutesSince: jest.fn().mockResolvedValue([]),
    };
    members = {
      listBySpace: jest
        .fn()
        .mockResolvedValue([{ user: { id: 1 } }, { user: { id: 2 } }]),
    };
    dvr = { findBySpaceId: jest.fn().mockResolvedValue(null) };
    service = new MemberActivityService(
      activity as never,
      members as never,
      dvr as never,
    );
  });

  const run = async (days?: number) => {
    const result = await service.getActivity('space', days, NOW);
    if (!result.ok) throw new Error('expected data');
    return result.data;
  };

  it('scopes every query to the roster and defaults the timezone', async () => {
    const data = await run();

    expect(data.timezone).toBe('America/Montevideo');
    expect(activity.findSessionStarts).toHaveBeenCalledWith(
      [1, 2],
      expect.any(Date),
    );
    expect(activity.lastAccess).toHaveBeenCalledWith([1, 2]);
    expect(activity.findWatchMinutesSince).toHaveBeenCalledWith(
      'space',
      [1, 2],
      expect.any(Date),
    );
  });

  it('passes an empty roster through to the accessors', async () => {
    members.listBySpace.mockResolvedValue([]);
    const data = await run();
    expect(activity.findSessionStarts).toHaveBeenCalledWith(
      [],
      expect.any(Date),
    );
    expect(data.accessesByDay).toEqual([]);
    expect(data.previous).toEqual({
      sessions: 0,
      activeUsers: 0,
      watchMinutes: 0,
    });
  });

  it('falls back when the DVR timezone is not a real zone', async () => {
    dvr.findBySpaceId.mockResolvedValue({ timezone: 'Not/AZone' });
    expect((await run()).timezone).toBe('America/Montevideo');
  });

  it('lists every day of the period, ending today', async () => {
    const data = await run(7);
    expect(data.days).toEqual([
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
    ]);
  });

  it('buckets session starts by day in the space timezone', async () => {
    activity.findSessionStarts.mockResolvedValue([
      // 02:59Z is still Sep 13 in Montevideo; 03:00Z is Sep 14.
      { userId: 1, at: new Date('2026-09-14T02:59:00Z') },
      { userId: 1, at: new Date('2026-09-14T03:00:00Z') },
      { userId: 1, at: new Date('2026-09-14T15:00:00Z') },
      { userId: 2, at: new Date('2026-09-14T15:00:00Z') },
    ]);

    const data = await run(7);

    expect(data.accessesByDay).toEqual(
      expect.arrayContaining([
        { date: '2026-09-13', userId: 1, sessions: 1 },
        { date: '2026-09-14', userId: 1, sessions: 2 },
        { date: '2026-09-14', userId: 2, sessions: 1 },
      ]),
    );
    expect(data.accessesByDay).toHaveLength(3);
  });

  it('totals the previous period apart from the period', async () => {
    activity.findSessionStarts.mockResolvedValue([
      { userId: 1, at: new Date('2026-09-14T15:00:00Z') }, // period
      { userId: 1, at: new Date('2026-09-05T15:00:00Z') }, // previous (Sep 2-8)
      { userId: 1, at: new Date('2026-09-06T15:00:00Z') }, // previous
      { userId: 2, at: new Date('2026-09-07T15:00:00Z') }, // previous
      { userId: 2, at: new Date('2026-08-30T15:00:00Z') }, // before both
    ]);
    activity.findWatchMinutesSince.mockResolvedValue([
      { userId: 1, cameraId: 'c1', minute: new Date('2026-09-14T15:00:00Z') },
      { userId: 1, cameraId: 'c1', minute: new Date('2026-09-05T15:00:00Z') },
      { userId: 2, cameraId: 'c2', minute: new Date('2026-09-06T15:00:00Z') },
      { userId: 2, cameraId: 'c2', minute: new Date('2026-08-30T15:00:00Z') },
    ]);

    const data = await run(7);

    expect(data.accessesByDay).toEqual([
      { date: '2026-09-14', userId: 1, sessions: 1 },
    ]);
    expect(data.previous).toEqual({
      sessions: 3,
      activeUsers: 2,
      watchMinutes: 2,
    });
  });

  it('aggregates watch minutes by day and by user and camera', async () => {
    const at = (iso: string) => new Date(iso);
    activity.findWatchMinutesSince.mockResolvedValue([
      { userId: 1, cameraId: 'c1', minute: at('2026-09-14T15:00:00Z') },
      { userId: 1, cameraId: 'c1', minute: at('2026-09-14T15:01:00Z') },
      { userId: 2, cameraId: 'c1', minute: at('2026-09-14T15:01:00Z') },
      { userId: 2, cameraId: 'c2', minute: at('2026-09-15T15:00:00Z') },
    ]);

    const data = await run(7);

    expect(data.watchByDay).toEqual(
      expect.arrayContaining([
        { date: '2026-09-14', cameraId: 'c1', minutes: 3 },
        { date: '2026-09-15', cameraId: 'c2', minutes: 1 },
      ]),
    );
    expect(data.watchByUserCamera).toEqual(
      expect.arrayContaining([
        { userId: 1, cameraId: 'c1', minutes: 2 },
        { userId: 2, cameraId: 'c1', minutes: 1 },
        { userId: 2, cameraId: 'c2', minutes: 1 },
      ]),
    );
  });

  it('serialises lastAccess as ISO strings', async () => {
    activity.lastAccess.mockResolvedValue([
      { userId: 1, at: new Date('2026-01-02T03:04:05.000Z') },
    ]);
    expect((await run()).lastAccess).toEqual([
      { userId: 1, at: '2026-01-02T03:04:05.000Z' },
    ]);
  });
});
