import { createTransport } from 'nodemailer';
import { EnvNames } from '../common/constants';
import { MailerService } from './mailer.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const createTransportMock = createTransport as jest.MockedFunction<
  typeof createTransport
>;

describe('MailerService', () => {
  let sendMail: jest.Mock;

  function serviceFor(overrides: Record<string, unknown> = {}) {
    const env: Record<string, unknown> = {
      [EnvNames.SMTP_HOST]: '127.0.0.1',
      [EnvNames.SMTP_PORT]: 1025,
      [EnvNames.MAIL_FROM]: 'Tu Seguridad <no-reply@tu-seguridad.local>',
      ...overrides,
    };
    return new MailerService({
      get: (key: string) => env[key],
    } as never);
  }

  beforeEach(() => {
    sendMail = jest.fn().mockResolvedValue({ messageId: '<mail-1@local>' });
    createTransportMock.mockReturnValue({ sendMail } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('uses implicit TLS on port 465', () => {
    serviceFor({ [EnvNames.SMTP_PORT]: 465 });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 465,
        secure: true,
      }),
    );
  });

  it('leaves TLS non-implicit on any other port', () => {
    serviceFor({ [EnvNames.SMTP_PORT]: 1025 });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1025,
        secure: false,
      }),
    );
  });

  it('omits auth entirely when no SMTP user is configured', () => {
    serviceFor({ [EnvNames.SMTP_USER]: '' });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  it('authenticates when a user is configured', () => {
    serviceFor({
      [EnvNames.SMTP_USER]: 'sender@gmail.com',
      [EnvNames.SMTP_PASSWORD]: 'app-password',
    });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'sender@gmail.com', pass: 'app-password' },
      }),
    );
  });

  it('sends the mail with the configured from address and resolves with sendMail result', async () => {
    const result = await serviceFor().send({
      to: 'member@example.com',
      subject: 'Subject',
      text: 'text body',
      html: '<p>html body</p>',
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: 'Tu Seguridad <no-reply@tu-seguridad.local>',
      to: 'member@example.com',
      subject: 'Subject',
      text: 'text body',
      html: '<p>html body</p>',
    });
    expect(result).toEqual({ messageId: '<mail-1@local>' });
  });

  it('rejects when sendMail rejects, without swallowing the failure', async () => {
    sendMail.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:1025'));

    await expect(
      serviceFor().send({
        to: 'member@example.com',
        subject: 'Subject',
        text: 'text body',
        html: '<p>html body</p>',
      }),
    ).rejects.toThrow('ECONNREFUSED 127.0.0.1:1025');
  });
});
