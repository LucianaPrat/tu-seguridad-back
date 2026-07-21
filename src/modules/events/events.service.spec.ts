import { EventsService } from './events.service';

describe('EventsService', () => {
  const storedEvent = {
    id: 1,
    eventId: 'evt-1',
    eventType: 'PERSON_ENTERED_ZONE',
    cameraId: 'camera_01',
    zoneId: 'zone_lobby',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    confidence: 0.9,
    personsInZone: 1,
    anchor: { x: 0.5, y: 0.9 },
  };

  let zoneEventAccessor: {
    query: jest.Mock;
    create: jest.Mock;
    findByEventId: jest.Mock;
  };
  let gateway: { broadcastZoneEvent: jest.Mock };
  let service: EventsService;

  beforeEach(() => {
    zoneEventAccessor = {
      query: jest.fn(),
      create: jest.fn(),
      findByEventId: jest.fn(),
    };
    gateway = { broadcastZoneEvent: jest.fn() };
    service = new EventsService(zoneEventAccessor as never, gateway as never);
  });

  describe('query', () => {
    it('defaults the limit to 100', async () => {
      zoneEventAccessor.query.mockResolvedValue([]);

      await service.query({});

      expect(zoneEventAccessor.query).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 }),
      );
    });

    it('clamps a limit above 1000 down to 1000, without erroring', async () => {
      zoneEventAccessor.query.mockResolvedValue([]);

      const result = await service.query({ limit: 5000 });

      expect(result.ok).toBe(true);
      expect(zoneEventAccessor.query).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1000 }),
      );
    });

    it('clamps a non-positive limit up to 1', async () => {
      zoneEventAccessor.query.mockResolvedValue([]);

      await service.query({ limit: -5 });

      expect(zoneEventAccessor.query).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1 }),
      );
    });

    it('converts from/to strings into Date filters', async () => {
      zoneEventAccessor.query.mockResolvedValue([]);

      await service.query({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
      });

      expect(zoneEventAccessor.query).toHaveBeenCalledWith(
        expect.objectContaining({
          from: new Date('2026-01-01T00:00:00.000Z'),
          to: new Date('2026-01-02T00:00:00.000Z'),
        }),
      );
    });

    it('returns mapped events, newest first as given by the accessor', async () => {
      zoneEventAccessor.query.mockResolvedValue([storedEvent]);

      const result = await service.query({});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([
          expect.objectContaining({ eventId: 'evt-1' }),
        ]);
      }
    });
  });

  describe('emit', () => {
    it('creates and broadcasts a new event', async () => {
      zoneEventAccessor.findByEventId.mockResolvedValue(null);
      zoneEventAccessor.create.mockResolvedValue(storedEvent);

      const dto = await service.emit({
        eventId: 'evt-1',
        eventType: 'PERSON_ENTERED_ZONE',
        cameraId: 'camera_01',
        zoneId: 'zone_lobby',
        occurredAt: storedEvent.occurredAt,
        personsInZone: 1,
      } as never);

      expect(zoneEventAccessor.create).toHaveBeenCalled();
      expect(gateway.broadcastZoneEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1' }),
      );
      expect(dto.eventId).toBe('evt-1');
    });

    it('is idempotent on eventId: skips create and still broadcasts for a duplicate', async () => {
      zoneEventAccessor.findByEventId.mockResolvedValue(storedEvent);

      await service.emit({ eventId: 'evt-1' } as never);

      expect(zoneEventAccessor.create).not.toHaveBeenCalled();
      expect(gateway.broadcastZoneEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1' }),
      );
    });
  });
});
