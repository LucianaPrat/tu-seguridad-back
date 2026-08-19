import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { EnvNames } from '../../cross/common/constants';
import {
  CredentialDelivery,
  CredentialDeliveryPort,
  DeliveredCredentialPurpose,
} from './credential-delivery.port';

/**
 * Where each credential lands in the frontend. The paths are this repo's
 * assumption about the client's routes, not a contract the client publishes —
 * when the real routes exist, this map is the single place to correct.
 */
const CREDENTIAL_MAIL: Record<
  DeliveredCredentialPurpose,
  { path: string; subject: string }
> = {
  invitation: {
    path: '/invitations/accept',
    subject: 'You have been invited to Tu Seguridad',
  },
  magic_link: {
    path: '/auth/magic',
    subject: 'Your Tu Seguridad sign-in link',
  },
  password_reset: {
    path: '/auth/reset-password',
    subject: 'Reset your Tu Seguridad password',
  },
};

/** Implicit TLS. Every other port negotiates STARTTLS or stays plain. */
const IMPLICIT_TLS_PORT = 465;

/**
 * The SMTP delivery channel, selected by `MAIL_ENABLED` in `auth.module.ts`. The
 * transport is entirely env-driven: the local default is the mailpit container
 * (`127.0.0.1:1025`, no authentication), and pointing the same code at
 * `smtp.gmail.com:465` with an app password is a `.env` change, not a code change.
 *
 * The link is the credential. Neither it nor the raw token is ever logged — the
 * invariant `LoggedCredentialDeliveryService` documents holds here too, and it
 * matters more, because this service runs in production.
 */
@Injectable()
export class SmtpCredentialDeliveryService implements CredentialDeliveryPort {
  private readonly logger = new Logger(SmtpCredentialDeliveryService.name);
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo>;
  private readonly from: string;
  private readonly appBaseUrl: string;

  constructor(configService: ConfigService) {
    const port = configService.get<number>(EnvNames.SMTP_PORT)!;
    const user = configService.get<string>(EnvNames.SMTP_USER);
    const pass = configService.get<string>(EnvNames.SMTP_PASSWORD);

    this.transporter = createTransport({
      host: configService.get<string>(EnvNames.SMTP_HOST),
      port,
      secure: port === IMPLICIT_TLS_PORT,
      // Omitted rather than sent empty: an unauthenticated relay must not receive
      // a login attempt with a blank password.
      auth: user ? { user, pass } : undefined,
    });
    this.from = configService.get<string>(EnvNames.MAIL_FROM)!;
    this.appBaseUrl = configService.get<string>(EnvNames.APP_BASE_URL)!;
  }

  async deliver(delivery: CredentialDelivery): Promise<void> {
    const { path, subject } = CREDENTIAL_MAIL[delivery.purpose];
    // Concatenated rather than `new URL(path, base)`: a leading-slash path is
    // absolute, so resolving it against a base would silently drop any subpath
    // the frontend is mounted under. URL still owns the query encoding.
    const link = new URL(`${this.appBaseUrl.replace(/\/+$/, '')}${path}`);
    link.searchParams.set('token', delivery.token);
    const expiresAt = delivery.expiresAt.toISOString();

    try {
      const sent = await this.transporter.sendMail({
        from: this.from,
        to: delivery.email,
        subject,
        text: `${subject}\n\n${link.href}\n\nThe link expires at ${expiresAt} and can be used once.`,
        html: `<p>${subject}</p><p><a href="${link.href}">Continue</a></p><p>The link expires at ${expiresAt} and can be used once.</p>`,
      });

      this.logger.log({
        msg: 'credential delivered',
        purpose: delivery.purpose,
        recipient: delivery.email,
        messageId: sent.messageId,
        expiresAt,
      });
    } catch (error) {
      // Swallowed on purpose. Both callers await this after their row is already
      // written, and `CredentialRecoveryService` owes an identical response for a
      // registered and an unregistered address — a throw would turn invitation
      // creation into a 500 and make a failed reset distinguishable from a
      // successful one.
      this.logger.error({
        msg: 'credential delivery failed',
        purpose: delivery.purpose,
        recipient: delivery.email,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
