import { Logger } from '@nestjs/common';
import { LoggedCredentialDeliveryService } from './logged-credential-delivery.service';

describe('LoggedCredentialDeliveryService', () => {
  const delivery = {
    purpose: 'invitation' as const,
    email: 'member@example.com',
    token: 'raw-secret-token',
    expiresAt: new Date('2026-08-25T00:00:00.000Z'),
  };

  function serviceFor(nodeEnv: string) {
    return new LoggedCredentialDeliveryService({
      get: () => nodeEnv,
    } as never);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prints the raw token in development so a local flow can be finished', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await serviceFor('development').deliver(delivery);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('raw-secret-token'),
    );
  });

  it('never logs the token in production', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await serviceFor('production').deliver(delivery);

    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('raw-secret-token');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'invitation' }),
    );
  });

  it('never logs the token under test either, so no fixture can carry one', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await serviceFor('test').deliver(delivery);

    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('raw-secret-token');
  });
});
