import { Logger } from '@nestjs/common';
import { EnvNames } from '../../cross/common/constants';
import { MailerService } from '../../cross/mail/mailer.service';
import { DeliveredCredentialPurpose } from './credential-delivery.port';
import { SmtpCredentialDeliveryService } from './smtp-credential-delivery.service';

const TOKEN = 'raw-secret-token';

type SentMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

describe('SmtpCredentialDeliveryService', () => {
  const delivery = {
    purpose: 'invitation' as DeliveredCredentialPurpose,
    email: 'member@example.com',
    token: TOKEN,
    expiresAt: new Date('2026-08-25T00:00:00.000Z'),
  };

  let mailer: { send: jest.Mock };

  function serviceFor(overrides: Record<string, unknown> = {}) {
    const env: Record<string, unknown> = {
      [EnvNames.APP_BASE_URL]: 'http://localhost:5173',
      ...overrides,
    };
    return new SmtpCredentialDeliveryService(
      { get: (key: string) => env[key] } as never,
      mailer as unknown as MailerService,
    );
  }

  function sentMessage(): SentMail {
    const calls = mailer.send.mock.calls as SentMail[][];
    return calls[0][0];
  }

  beforeEach(() => {
    mailer = {
      send: jest.fn().mockResolvedValue({ messageId: '<mail-1@local>' }),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it.each([
    [
      'invitation',
      '/invitations/accept',
      'You have been invited to Tu Seguridad',
    ],
    ['magic_link', '/auth/magic', 'Your Tu Seguridad sign-in link'],
    [
      'password_reset',
      '/auth/reset-password',
      'Reset your Tu Seguridad password',
    ],
  ])(
    'sends the %s credential as a link to %s',
    async (purpose, path, subject) => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await serviceFor().deliver({
        ...delivery,
        purpose: purpose as DeliveredCredentialPurpose,
      });

      const message = sentMessage();
      expect(message.to).toBe('member@example.com');
      expect(message.subject).toBe(subject);
      const link = `http://localhost:5173${path}?token=${TOKEN}`;
      expect(message.text).toContain(link);
      expect(message.html).toContain(`href="${link}"`);
      expect(message.text).toContain('2026-08-25T00:00:00.000Z');
    },
  );

  it('honours a non-root APP_BASE_URL without swallowing its path', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await serviceFor({
      [EnvNames.APP_BASE_URL]: 'http://localhost:5173/app/',
    }).deliver(delivery);

    expect(sentMessage().text).toContain(
      `http://localhost:5173/app/invitations/accept?token=${TOKEN}`,
    );
  });

  it('never logs the credential on success', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await serviceFor().deliver(delivery);

    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'invitation',
        recipient: 'member@example.com',
        messageId: '<mail-1@local>',
      }),
    );
  });

  it('logs and absorbs a transport failure instead of failing the caller', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    mailer.send.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:1025'));

    await expect(serviceFor().deliver(delivery)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'ECONNREFUSED 127.0.0.1:1025' }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
  });
});
