import { ConfigService } from '@nestjs/config';
import { EnvNames } from '../../cross/common/constants';
import { DeliveryRetryService } from './delivery-retry.service';

const NOW = new Date('2026-09-01T12:00:00.000Z').getTime();
const DELAY_SECONDS = 300;

function delivery(id: string, eventId: string, spaceId = 'space-1') {
  return {
    id,
    eventId,
    channel: 'email',
    status: 'failed',
    attempts: 1,
    event: { id: eventId, spaceId },
  };
}

describe('DeliveryRetryService', () => {
  let config: Record<string, unknown>;
  let deliveryAccessor: { findRetryable: jest.Mock };
  let spaceMemberAccessor: { findActiveRecipients: jest.Mock };
  let alertEmail: { resend: jest.Mock };
  let service: DeliveryRetryService;

  const build = () =>
    new DeliveryRetryService(
      {
        get: (key: string) => config[key],
        getOrThrow: (key: string) => {
          const value = config[key];
          if (value === undefined) {
            throw new Error(`missing ${key}`);
          }
          return value;
        },
      } as unknown as ConfigService,
      deliveryAccessor as never,
      spaceMemberAccessor as never,
      alertEmail as never,
    );

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    config = {
      [EnvNames.DELIVERY_RETRY_ENABLED]: true,
      [EnvNames.DELIVERY_RETRY_DELAY_SECONDS]: DELAY_SECONDS,
      [EnvNames.DELIVERY_RETRY_MAX_ATTEMPTS]: 3,
    };
    deliveryAccessor = { findRetryable: jest.fn().mockResolvedValue([]) };
    spaceMemberAccessor = {
      findActiveRecipients: jest.fn().mockResolvedValue([]),
    };
    alertEmail = { resend: jest.fn().mockResolvedValue(undefined) };
    service = build();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing at all when the retry is off', async () => {
    config[EnvNames.DELIVERY_RETRY_ENABLED] = false;

    await build().sweep();

    expect(deliveryAccessor.findRetryable).not.toHaveBeenCalled();
  });

  it('asks only for rows past the delay and under the attempt cap', async () => {
    await service.sweep();

    expect(deliveryAccessor.findRetryable).toHaveBeenCalledWith(
      new Date(NOW - DELAY_SECONDS * 1000),
      3,
      expect.any(Number),
    );
  });

  it('sends nothing when there is nothing stuck', async () => {
    await service.sweep();

    expect(alertEmail.resend).not.toHaveBeenCalled();
  });

  /**
   * Everything a send needs beyond the row — the frame, the recorder time zone,
   * the space's recipients — is per event, so two rows for one alert must not
   * load all of it twice.
   */
  it('groups the rows by event, one resend per event', async () => {
    deliveryAccessor.findRetryable.mockResolvedValue([
      delivery('d1', 'event-1'),
      delivery('d2', 'event-1'),
      delivery('d3', 'event-2'),
    ]);

    await service.sweep();

    expect(alertEmail.resend).toHaveBeenCalledTimes(2);
    expect(spaceMemberAccessor.findActiveRecipients).toHaveBeenCalledTimes(2);
    const firstCall = alertEmail.resend.mock.calls[0] as [
      { id: string },
      unknown[],
    ];
    expect(firstCall[0]).toMatchObject({ id: 'event-1' });
    expect(firstCall[1]).toHaveLength(2);
  });

  it('keeps going when one event fails', async () => {
    deliveryAccessor.findRetryable.mockResolvedValue([
      delivery('d1', 'event-1'),
      delivery('d2', 'event-2'),
    ]);
    alertEmail.resend.mockRejectedValueOnce(new Error('relay down'));

    await expect(service.sweep()).resolves.toBeUndefined();

    expect(alertEmail.resend).toHaveBeenCalledTimes(2);
  });

  it('survives a database that will not answer', async () => {
    deliveryAccessor.findRetryable.mockRejectedValue(new Error('gone'));

    await expect(service.sweep()).resolves.toBeUndefined();

    expect(alertEmail.resend).not.toHaveBeenCalled();
  });
});
