import { AlertEvent, Prisma } from '@prisma/client';
import { ErrorCode, EventHistory } from '../../cross/common/constants';
import { AlertCandidate } from '../pipeline/alert-candidate';
import { AlertEventsService } from './alert-events.service';
import { ALERT_EVENT_MESSAGE } from './events.gateway';

const spaceId = 'space-uuid';

/** Every acknowledgement outcome answers this, so the route reveals no event. */
const ACCEPTED = { ok: true, data: { accepted: true } };

function buildEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 'event-1',
    spaceId,
    cameraId: 'camera-uuid',
    zoneId: null,
    cameraLabelSnapshot: 'Front door – Street side',
    alertType: 'intruder',
    detectedAt: new Date('2026-08-01T10:00:00.000Z'),
    snapshotId: 'snapshot-uuid',
    personsDetected: 1,
    confidence: new Prisma.Decimal('0.913'),
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  };
}

function buildCandidate(
  overrides: Partial<AlertCandidate> = {},
): AlertCandidate {
  return {
    cameraId: 'camera-uuid',
    cameraLabel: 'Front door – Street side',
    zoneId: null,
    alertType: 'intruder',
    detectedAt: new Date('2026-08-01T10:00:00.000Z'),
    snapshotId: 'snapshot-uuid',
    personsDetected: 1,
    confidence: 0.9,
    ...overrides,
  };
}

describe('AlertEventsService', () => {
  let alertEventAccessor: {
    create: jest.Mock;
    findById: jest.Mock;
    query: jest.Mock;
  };
  let deliveryAccessor: {
    createManyForEvent: jest.Mock;
    findByEventId: jest.Mock;
    consumeInbound: jest.Mock;
  };
  let routingAccessor: { findEnabled: jest.Mock };
  let memberAccessor: { findActiveRecipients: jest.Mock };
  let secretToken: { generate: jest.Mock };
  let gateway: { broadcast: jest.Mock };
  let alertEmail: { dispatch: jest.Mock };
  let ackToken: { issue: jest.Mock; resolve: jest.Mock };
  let service: AlertEventsService;

  beforeEach(() => {
    alertEventAccessor = {
      create: jest.fn().mockResolvedValue(buildEvent()),
      findById: jest.fn(),
      query: jest.fn().mockResolvedValue([]),
    };
    deliveryAccessor = {
      createManyForEvent: jest.fn().mockResolvedValue(0),
      findByEventId: jest.fn().mockResolvedValue([]),
      consumeInbound: jest.fn().mockResolvedValue(null),
    };
    routingAccessor = { findEnabled: jest.fn().mockResolvedValue([]) };
    memberAccessor = { findActiveRecipients: jest.fn().mockResolvedValue([]) };
    let issued = 0;
    secretToken = { generate: jest.fn(() => `correlation-${++issued}`) };
    gateway = { broadcast: jest.fn() };
    alertEmail = { dispatch: jest.fn().mockResolvedValue(undefined) };
    ackToken = {
      issue: jest.fn(() => 'a.token'),
      resolve: jest.fn(() => null),
    };
    service = new AlertEventsService(
      alertEventAccessor as never,
      deliveryAccessor as never,
      routingAccessor as never,
      memberAccessor as never,
      secretToken,
      gateway as never,
      alertEmail as never,
      ackToken as never,
    );
  });

  describe('record', () => {
    it('stores the label, alert type and detection metrics the pipeline decided, not a camera reference', async () => {
      await service.record(spaceId, [buildCandidate({ zoneId: 'zone-uuid' })]);

      expect(alertEventAccessor.create).toHaveBeenCalledWith(spaceId, {
        cameraId: 'camera-uuid',
        zoneId: 'zone-uuid',
        cameraLabelSnapshot: 'Front door – Street side',
        alertType: 'intruder',
        detectedAt: new Date('2026-08-01T10:00:00.000Z'),
        snapshotId: 'snapshot-uuid',
        personsDetected: 1,
        confidence: 0.9,
      });
    });

    it('writes one delivery per enabled channel per opted-in recipient, each with its own correlation id', async () => {
      routingAccessor.findEnabled.mockResolvedValue([
        { channel: 'email' },
        { channel: 'whatsapp' },
      ]);
      memberAccessor.findActiveRecipients.mockResolvedValue([
        { userId: 1 },
        { userId: 2 },
      ]);

      await service.record(spaceId, [buildCandidate()]);

      expect(deliveryAccessor.createManyForEvent).toHaveBeenCalledWith(
        spaceId,
        'event-1',
        [
          {
            channel: 'email',
            recipientUserId: 1,
            correlationId: 'correlation-1',
          },
          {
            channel: 'email',
            recipientUserId: 2,
            correlationId: 'correlation-2',
          },
          {
            channel: 'whatsapp',
            recipientUserId: 1,
            correlationId: 'correlation-3',
          },
          {
            channel: 'whatsapp',
            recipientUserId: 2,
            correlationId: 'correlation-4',
          },
        ],
      );
    });

    it('plans no delivery when the space routes the alert type nowhere', async () => {
      memberAccessor.findActiveRecipients.mockResolvedValue([{ userId: 1 }]);

      await service.record(spaceId, [buildCandidate()]);

      expect(deliveryAccessor.createManyForEvent).toHaveBeenCalledWith(
        spaceId,
        'event-1',
        [],
      );
    });

    it('broadcasts the stored event to its own space only', async () => {
      await service.record(spaceId, [buildCandidate()]);

      expect(gateway.broadcast).toHaveBeenCalledWith(
        spaceId,
        ALERT_EVENT_MESSAGE,
        expect.objectContaining({
          id: 'event-1',
          cameraLabel: 'Front door – Street side',
          snapshotUrl: '/api/v1/snapshots/snapshot-uuid',
        }),
      );
    });

    it('drops a candidate the accessor refuses, without broadcasting it', async () => {
      alertEventAccessor.create.mockResolvedValue(null);

      const events = await service.record(spaceId, [buildCandidate()]);

      expect(events).toEqual([]);
      expect(deliveryAccessor.createManyForEvent).not.toHaveBeenCalled();
      expect(gateway.broadcast).not.toHaveBeenCalled();
      expect(alertEmail.dispatch).not.toHaveBeenCalled();
    });

    it('hands the stored delivery rows and their recipients to the email channel', async () => {
      const rows = [
        {
          id: 'delivery-1',
          channel: 'email',
          recipientUserId: 1,
          status: 'pending',
        },
      ];
      routingAccessor.findEnabled.mockResolvedValue([{ channel: 'email' }]);
      memberAccessor.findActiveRecipients.mockResolvedValue([
        { userId: 1, user: { email: 'owner@example.com', firstName: 'Ada' } },
      ]);
      deliveryAccessor.createManyForEvent.mockResolvedValue(1);
      deliveryAccessor.findByEventId.mockResolvedValue(rows);

      await service.record(spaceId, [buildCandidate()]);

      expect(deliveryAccessor.findByEventId).toHaveBeenCalledWith(
        spaceId,
        'event-1',
      );
      expect(alertEmail.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'event-1' }),
        rows,
        [{ userId: 1, user: { email: 'owner@example.com', firstName: 'Ada' } }],
      );
    });

    it('reads no delivery row back when the fan-out planned nothing', async () => {
      await service.record(spaceId, [buildCandidate()]);

      expect(deliveryAccessor.findByEventId).not.toHaveBeenCalled();
      expect(alertEmail.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'event-1' }),
        [],
        [],
      );
    });
  });

  describe('query', () => {
    it('asks for one row past the page and reports no next cursor when it is absent', async () => {
      alertEventAccessor.query.mockResolvedValue([buildEvent()]);

      const result = await service.query(spaceId, { limit: 2 });

      expect(alertEventAccessor.query).toHaveBeenCalledWith(spaceId, {
        alertType: undefined,
        from: undefined,
        take: 3,
        cursor: undefined,
      });
      expect(result).toEqual({
        ok: true,
        data: {
          items: [expect.objectContaining({ id: 'event-1' })],
          nextCursor: null,
        },
      });
    });

    it('trims the extra row and returns a cursor built from the last kept event', async () => {
      alertEventAccessor.query.mockResolvedValue([
        buildEvent({ id: 'event-1' }),
        buildEvent({ id: 'event-2' }),
        buildEvent({ id: 'event-3' }),
      ]);

      const result = await service.query(spaceId, { limit: 2 });

      if (!result.ok) {
        throw new Error('expected a page');
      }
      expect(result.data.items.map((item) => item.id)).toEqual([
        'event-1',
        'event-2',
      ]);
      expect(result.data.nextCursor).toBe(
        Buffer.from('2026-08-01T10:00:00.000Z|event-2').toString('base64url'),
      );
    });

    it('defaults the page size and forwards the filters', async () => {
      await service.query(spaceId, {
        alertType: 'suspicious',
        from: '2026-08-01T00:00:00.000Z',
      });

      expect(alertEventAccessor.query).toHaveBeenCalledWith(spaceId, {
        alertType: 'suspicious',
        from: new Date('2026-08-01T00:00:00.000Z'),
        take: EventHistory.DEFAULT_PAGE_SIZE + 1,
        cursor: undefined,
      });
    });

    it('decodes a cursor into the ordering tuple', async () => {
      await service.query(spaceId, {
        cursor: Buffer.from('2026-08-01T10:00:00.000Z|event-2').toString(
          'base64url',
        ),
      });

      expect(alertEventAccessor.query).toHaveBeenCalledWith(
        spaceId,
        expect.objectContaining({
          cursor: {
            detectedAt: new Date('2026-08-01T10:00:00.000Z'),
            id: 'event-2',
          },
        }),
      );
    });

    it('rejects a cursor it did not issue instead of paging from the start', async () => {
      const result = await service.query(spaceId, { cursor: 'not-a-cursor' });

      expect(result).toMatchObject({
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
      });
      expect(alertEventAccessor.query).not.toHaveBeenCalled();
    });
  });

  describe('findDeliveries', () => {
    it('is a not-found for an event outside the caller space', async () => {
      alertEventAccessor.findById.mockResolvedValue(null);

      const result = await service.findDeliveries(spaceId, 'event-1');

      expect(result).toMatchObject({ ok: false, code: ErrorCode.NOT_FOUND });
      expect(deliveryAccessor.findByEventId).not.toHaveBeenCalled();
    });

    it('never returns the correlation id of an attempt', async () => {
      alertEventAccessor.findById.mockResolvedValue(buildEvent());
      deliveryAccessor.findByEventId.mockResolvedValue([
        {
          id: 'delivery-1',
          eventId: 'event-1',
          channel: 'email',
          recipientUserId: 1,
          status: 'pending',
          correlationId: 'secret-correlation-id',
          sentAt: null,
          deliveredAt: null,
          providerMessageId: null,
          error: null,
          inboundReceivedAt: null,
          createdAt: new Date('2026-08-01T10:00:00.000Z'),
          updatedAt: new Date('2026-08-01T10:00:00.000Z'),
        },
      ]);

      const result = await service.findDeliveries(spaceId, 'event-1');

      if (!result.ok) {
        throw new Error('expected the delivery list');
      }
      expect(JSON.stringify(result.data)).not.toContain(
        'secret-correlation-id',
      );
      expect(result.data[0]).not.toHaveProperty('correlationId');
    });
  });

  describe('acknowledgeInbound', () => {
    it('answers the same for a match, a repeat and an unknown correlation id', async () => {
      deliveryAccessor.consumeInbound
        .mockResolvedValueOnce({
          deliveryId: 'delivery-1',
          eventId: 'event-1',
          acknowledgedByUserId: 1,
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const matched = await service.acknowledgeInbound({
        correlationId: 'correlation-1',
      });
      const repeated = await service.acknowledgeInbound({
        correlationId: 'correlation-1',
      });
      const unknown = await service.acknowledgeInbound({
        correlationId: 'never-issued',
      });

      expect(matched).toEqual(ACCEPTED);
      expect(repeated).toEqual(ACCEPTED);
      expect(unknown).toEqual(ACCEPTED);
    });

    it('resolves an emailed token to its delivery and claims that row by id', async () => {
      ackToken.resolve.mockReturnValue('delivery-9');

      const result = await service.acknowledgeInbound({ token: 'a.token' });

      expect(ackToken.resolve).toHaveBeenCalledWith('a.token');
      expect(deliveryAccessor.consumeInbound).toHaveBeenCalledWith({
        id: 'delivery-9',
      });
      expect(result).toEqual(ACCEPTED);
    });

    it('answers a token that fails its signature exactly like a good one', async () => {
      ackToken.resolve.mockReturnValue(null);

      const result = await service.acknowledgeInbound({ token: 'forged' });

      expect(deliveryAccessor.consumeInbound).not.toHaveBeenCalled();
      expect(result).toEqual(ACCEPTED);
    });

    it('refuses a call that presents both credentials or neither', async () => {
      for (const dto of [
        {},
        { correlationId: 'correlation-1', token: 'a.token' },
      ]) {
        const result = await service.acknowledgeInbound(dto);

        expect(result).toEqual({
          ok: false,
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Send exactly one of correlationId or token',
        });
      }
      expect(deliveryAccessor.consumeInbound).not.toHaveBeenCalled();
    });
  });
});
