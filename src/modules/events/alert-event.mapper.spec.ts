import { AlertEvent } from '@prisma/client';
import { decodeCursor, encodeCursor } from './alert-event.mapper';

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
