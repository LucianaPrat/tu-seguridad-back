import { AlertEvent, Prisma } from '@prisma/client';
import {
  decodeCursor,
  encodeCursor,
  toAlertEventDto,
} from './alert-event.mapper';

function buildEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 'event-1',
    spaceId: 'space-uuid',
    cameraId: 'camera-uuid',
    zoneId: null,
    cameraLabelSnapshot: 'Front door',
    alertType: 'intruder',
    detectedAt: new Date('2026-08-01T10:00:00.000Z'),
    snapshotId: null,
    personsDetected: 1,
    confidence: new Prisma.Decimal('0.913'),
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  };
}

describe('alert event cursor', () => {
  it('round-trips the ordering tuple', () => {
    const event = buildEvent({ id: 'event-with|pipe' });

    expect(decodeCursor(encodeCursor(event))).toEqual({
      detectedAt: event.detectedAt,
      id: 'event-with|pipe',
    });
  });

  it.each([
    '',
    'not-base64url',
    Buffer.from('no-separator').toString('base64url'),
    Buffer.from('not-a-date|event-1').toString('base64url'),
    Buffer.from('2026-08-01T10:00:00.000Z|').toString('base64url'),
  ])('rejects %p instead of paging from the start', (value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});

describe('toAlertEventDto', () => {
  it('converts the stored confidence to a number, not the string a Decimal serializes to', () => {
    const dto = toAlertEventDto(
      buildEvent({
        personsDetected: 3,
        confidence: new Prisma.Decimal('0.913'),
      }),
    );

    expect(dto.confidence).toBe(0.913);
    expect(typeof dto.confidence).toBe('number');
    expect(dto.personsDetected).toBe(3);
  });

  it('carries both metrics through as null on an alert recorded before they were stored', () => {
    const dto = toAlertEventDto(
      buildEvent({ personsDetected: null, confidence: null }),
    );

    expect(dto.personsDetected).toBeNull();
    expect(dto.confidence).toBeNull();
  });
});
