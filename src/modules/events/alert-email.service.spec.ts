import { AlertEvent, EventDelivery, Prisma } from '@prisma/client';
import { EnvNames } from '../../cross/common/constants';
import { OutboundMail } from '../../cross/mail/mailer.service';
import { AlertEmailService } from './alert-email.service';

const spaceId = 'space-uuid';

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
    personsDetected: 2,
    confidence: new Prisma.Decimal('0.913'),
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  };
}

function buildDelivery(overrides: Partial<EventDelivery> = {}): EventDelivery {
  return {
    id: 'delivery-1',
    eventId: 'event-1',
    channel: 'email',
    recipientUserId: 1,
    status: 'pending',
    correlationId: 'correlation-secret-1',
    sentAt: null,
    deliveredAt: null,
    providerMessageId: null,
    error: null,
    inboundReceivedAt: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  };
}

function buildRecipient(userId = 1, email = 'owner@example.com') {
  return { userId, user: { email, firstName: 'Ada' } };
}

describe('AlertEmailService', () => {
  let mailer: { send: jest.Mock };
  let deliveryAccessor: { markSent: jest.Mock; markFailed: jest.Mock };

  function build(mailEnabled = true): AlertEmailService {
    const config = {
      get: (name: string) =>
        name === EnvNames.MAIL_ENABLED
          ? mailEnabled
          : 'http://localhost:5173/app',
    };
    return new AlertEmailService(
      config as never,
      mailer as never,
      deliveryAccessor as never,
    );
  }

  /** The mock is untyped, so one place does the narrowing every read needs. */
  function sentMail(index = 0): OutboundMail {
    const calls = mailer.send.mock.calls as OutboundMail[][];
    return calls[index][0];
  }

  beforeEach(() => {
    mailer = {
      send: jest.fn().mockResolvedValue({ messageId: 'relay-message-1' }),
    };
    deliveryAccessor = {
      markSent: jest.fn().mockResolvedValue(true),
      markFailed: jest.fn().mockResolvedValue(true),
    };
  });

  it('sends nothing and moves no row when MAIL_ENABLED is off', async () => {
    await build(false).dispatch(
      buildEvent(),
      [buildDelivery()],
      [buildRecipient()],
    );

    expect(mailer.send).not.toHaveBeenCalled();
    expect(deliveryAccessor.markSent).not.toHaveBeenCalled();
    expect(deliveryAccessor.markFailed).not.toHaveBeenCalled();
  });

  it('sends the email deliveries and leaves the channels with no sender pending', async () => {
    await build().dispatch(
      buildEvent(),
      [
        buildDelivery(),
        buildDelivery({ id: 'delivery-2', channel: 'whatsapp' }),
        buildDelivery({ id: 'delivery-3', channel: 'call' }),
      ],
      [buildRecipient()],
    );

    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(deliveryAccessor.markSent).toHaveBeenCalledTimes(1);
    expect(deliveryAccessor.markSent).toHaveBeenCalledWith(
      'delivery-1',
      'relay-message-1',
    );
  });

  it('skips a row another sender or an inbound callback already moved', async () => {
    await build().dispatch(
      buildEvent(),
      [buildDelivery({ status: 'delivered' })],
      [buildRecipient()],
    );

    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('addresses each recipient with its own message', async () => {
    await build().dispatch(
      buildEvent(),
      [
        buildDelivery(),
        buildDelivery({ id: 'delivery-2', recipientUserId: 2 }),
      ],
      [
        buildRecipient(1, 'owner@example.com'),
        buildRecipient(2, 'member@example.com'),
      ],
    );

    expect([sentMail(0).to, sentMail(1).to]).toEqual([
      'owner@example.com',
      'member@example.com',
    ]);
  });

  it('carries the alert type, the copied camera label, the detection time and a link that keeps the frontend subpath', async () => {
    await build().dispatch(buildEvent(), [buildDelivery()], [buildRecipient()]);

    const mail = sentMail();
    expect(mail.subject).toBe('Intruder alert — Front door – Street side');
    expect(mail.text).toContain('Front door – Street side');
    expect(mail.text).toContain('2026-08-01T10:00:00.000Z');
    expect(mail.text).toContain('People in frame: 2');
    expect(mail.text).toContain('http://localhost:5173/app/events/event-1');
    expect(mail.html).toContain('http://localhost:5173/app/events/event-1');
  });

  it('never puts the delivery correlation id in the message', async () => {
    await build().dispatch(buildEvent(), [buildDelivery()], [buildRecipient()]);

    const mail = sentMail();
    expect(JSON.stringify(mail)).not.toContain('correlation-secret-1');
  });

  it('escapes operator-supplied text in the html part', async () => {
    await build().dispatch(
      buildEvent({
        cameraLabelSnapshot: '<a href="http://evil.example">Gate</a>',
      }),
      [buildDelivery()],
      [buildRecipient()],
    );

    const mail = sentMail();
    expect(mail.html).not.toContain('<a href="http://evil.example">');
    expect(mail.html).toContain('&lt;a href=&quot;http://evil.example&quot;');
  });

  it('says the frame count was not recorded rather than printing null', async () => {
    await build().dispatch(
      buildEvent({ personsDetected: null }),
      [buildDelivery()],
      [buildRecipient()],
    );

    const mail = sentMail();
    expect(mail.text).toContain('People in frame: not recorded');
  });

  it('records the relay failure on the row instead of throwing at the pipeline', async () => {
    mailer.send.mockRejectedValue(new Error('relay refused the message'));

    await expect(
      build().dispatch(buildEvent(), [buildDelivery()], [buildRecipient()]),
    ).resolves.toBeUndefined();

    expect(deliveryAccessor.markFailed).toHaveBeenCalledWith(
      'delivery-1',
      'relay refused the message',
    );
    expect(deliveryAccessor.markSent).not.toHaveBeenCalled();
  });

  it('caps what a relay says before it becomes an API field', async () => {
    mailer.send.mockRejectedValue(new Error('x'.repeat(900)));

    await build().dispatch(buildEvent(), [buildDelivery()], [buildRecipient()]);

    const [, reason] = deliveryAccessor.markFailed.mock.calls[0] as [
      string,
      string,
    ];
    expect(reason).toHaveLength(500);
  });

  it('keeps sending the rest after one recipient fails', async () => {
    mailer.send
      .mockRejectedValueOnce(new Error('mailbox full'))
      .mockResolvedValueOnce({ messageId: 'relay-message-2' });

    await build().dispatch(
      buildEvent(),
      [
        buildDelivery(),
        buildDelivery({ id: 'delivery-2', recipientUserId: 2 }),
      ],
      [buildRecipient(1), buildRecipient(2, 'member@example.com')],
    );

    expect(deliveryAccessor.markFailed).toHaveBeenCalledWith(
      'delivery-1',
      'mailbox full',
    );
    expect(deliveryAccessor.markSent).toHaveBeenCalledWith(
      'delivery-2',
      'relay-message-2',
    );
  });

  it('fails a row whose recipient is no longer an alert recipient', async () => {
    await build().dispatch(buildEvent(), [buildDelivery()], []);

    expect(mailer.send).not.toHaveBeenCalled();
    expect(deliveryAccessor.markFailed).toHaveBeenCalledWith(
      'delivery-1',
      'recipient is no longer an alert recipient of this space',
    );
  });

  it('does not reject when recording the outcome is what failed', async () => {
    mailer.send.mockRejectedValue(new Error('relay down'));
    deliveryAccessor.markFailed.mockRejectedValue(new Error('database down'));

    await expect(
      build().dispatch(buildEvent(), [buildDelivery()], [buildRecipient()]),
    ).resolves.toBeUndefined();
  });
});
