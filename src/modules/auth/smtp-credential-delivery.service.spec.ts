import { Logger } from '@nestjs/common';
import { EnvNames } from '../../cross/common/constants';
import { MailerService } from '../../cross/mail/mailer.service';
import type { Locale } from '@prisma/client';
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
    locale: 'es' as Locale,
    invitation: {
      spaceName: 'Casa',
      inviterName: 'Ada',
      role: 'collaborator' as const,
    },
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
      'magic_link',
      'en',
      '/auth/magic',
      'Your Tu Seguridad sign-in link',
      'Continue',
    ],
    [
      'magic_link',
      'es',
      '/auth/magic',
      'Tu enlace de acceso a Tu Seguridad',
      'Continuar',
    ],
    [
      'password_reset',
      'en',
      '/auth/reset-password',
      'Reset your Tu Seguridad password',
      'Continue',
    ],
    [
      'password_reset',
      'es',
      '/auth/reset-password',
      'Restablece tu contraseña de Tu Seguridad',
      'Continuar',
    ],
  ])(
    'sends the %s credential in %s as a link to %s',
    async (purpose, locale, path, subject, button) => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await serviceFor().deliver({
        ...delivery,
        invitation: undefined,
        purpose: purpose as DeliveredCredentialPurpose,
        locale: locale as Locale,
      });

      const message = sentMessage();
      expect(message.to).toBe('member@example.com');
      expect(message.subject).toBe(subject);
      const link = `http://localhost:5173${path}?token=${TOKEN}`;
      expect(message.text).toContain(link);
      expect(message.html).toMatch(
        new RegExp(
          `<a href="${link.replace(/[?]/g, '\\?')}"[^>]*>${button}</a>`,
        ),
      );
      expect(message.text).toContain('2026-08-25T00:00:00.000Z');
    },
  );

  describe('invitation mail', () => {
    const invitation = {
      spaceName: 'Casa <b>& "Co"</b>',
      inviterName: 'Ada <script>',
      role: 'collaborator' as const,
    };

    it('is in Spanish with inviter, space, role, link and expiry date', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await serviceFor().deliver({ ...delivery, invitation });

      const message = sentMessage();
      expect(message.subject).toBe(
        'Ada <script> te invitó a Casa <b>& "Co"</b> en Tu Seguridad',
      );
      const link = `http://localhost:5173/invitations/accept?token=${TOKEN}`;
      expect(message.text).toContain('Rol: Colaborador');
      expect(message.text).toContain(`Ver invitación: ${link}`);
      expect(message.text).toContain('vence el 25/08/2026');
      expect(message.html).toMatch(
        new RegExp(
          `<a href="${link.replace(/[?]/g, '\\?')}"[^>]*>Ver invitación</a>`,
        ),
      );
      expect(message.html).toContain('vence el 25/08/2026');
    });

    it('is in English with an mm/dd/yyyy expiry for an en invitation', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await serviceFor().deliver({
        ...delivery,
        locale: 'en',
        invitation: { ...invitation, role: 'admin' },
      });

      const message = sentMessage();
      expect(message.subject).toBe(
        'Ada <script> invited you to Casa <b>& "Co"</b> on Tu Seguridad',
      );
      const link = `http://localhost:5173/invitations/accept?token=${TOKEN}`;
      expect(message.text).toContain('Role: Administrator');
      expect(message.text).toContain(`View invitation: ${link}`);
      expect(message.text).toContain('Expires on 08/25/2026');
      expect(message.html).toMatch(
        new RegExp(
          `<a href="${link.replace(/[?]/g, '\\?')}"[^>]*>View invitation</a>`,
        ),
      );
    });

    it('escapes the names in the HTML body', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await serviceFor().deliver({ ...delivery, invitation });

      const { html } = sentMessage();
      expect(html).toContain('Ada &lt;script&gt;');
      expect(html).toContain('Casa &lt;b&gt;&amp; &quot;Co&quot;&lt;/b&gt;');
      expect(html).not.toContain('<script>');
    });

    it.each([
      ['admin', 'Administrador'],
      ['guest', 'Invitado'],
    ] as const)('labels the %s role as %s', async (role, label) => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await serviceFor().deliver({
        ...delivery,
        invitation: { ...invitation, role },
      });

      expect(sentMessage().text).toContain(`Rol: ${label}`);
    });
  });

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
