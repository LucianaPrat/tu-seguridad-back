import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { EnvNames } from '../common/constants';

/** Implicit TLS. Every other port negotiates STARTTLS or stays plain. */
const IMPLICIT_TLS_PORT = 465;

/**
 * A file carried inside the message. `cid` is what makes it *inline*: the HTML
 * part references it as `cid:<value>`, so the image renders without the client
 * fetching anything — which also means no tracking pixel and no remote-image
 * warning banner.
 */
export interface OutboundAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string;
}

/** One message. `from` is not a caller's choice — the transport owns it. */
export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: OutboundAttachment[];
}

/**
 * The one SMTP transport in the process. Entirely env-driven: the local default
 * is the mailpit container (`127.0.0.1:1025`, no authentication), and pointing
 * the same code at `smtp.gmail.com:465` with an app password is a `.env` change,
 * not a code change. Every sender goes through here so that property holds for
 * all of them at once — two transports would drift the moment one gains a TLS
 * option the other does not.
 *
 * Whether mail is sent at all is `MAIL_ENABLED`, and each sender owns that
 * decision: this service is the transport, not the policy.
 */
@Injectable()
export class MailerService {
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo>;
  private readonly from: string;

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
  }

  /** Throws on relay failure. What a failure means is the caller's decision. */
  send(mail: OutboundMail): Promise<SMTPTransport.SentMessageInfo> {
    return this.transporter.sendMail({ from: this.from, ...mail });
  }
}
