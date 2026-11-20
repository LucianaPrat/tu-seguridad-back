import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvNames } from '../../cross/common/constants';
import { MailerService } from '../../cross/mail/mailer.service';
import type { SpaceMemberRole } from '@prisma/client';
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

// Product UI language; code and comments stay English.
const ROLE_LABEL: Record<SpaceMemberRole, string> = {
  admin: 'Administrador',
  collaborator: 'Colaborador',
  guest: 'Invitado',
};

/** Names are user input and land in HTML, so they are escaped there. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// UTC on purpose: the mail is rendered once for a recipient whose timezone is unknown.
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10).split('-').reverse().join('/');
}

/**
 * The SMTP delivery channel, selected by `MAIL_ENABLED` in `auth.module.ts`. The
 * transport lives in `MailerService` (`src/cross/mail/mailer.service.ts`); this
 * class owns only what a credential mail says.
 *
 * The link is the credential. Neither it nor the raw token is ever logged — the
 * invariant `LoggedCredentialDeliveryService` documents holds here too, and it
 * matters more, because this service runs in production.
 */
@Injectable()
export class SmtpCredentialDeliveryService implements CredentialDeliveryPort {
  private readonly logger = new Logger(SmtpCredentialDeliveryService.name);
  private readonly appBaseUrl: string;

  constructor(
    configService: ConfigService,
    private readonly mailer: MailerService,
  ) {
    this.appBaseUrl = configService.get<string>(EnvNames.APP_BASE_URL)!;
  }

  async deliver(delivery: CredentialDelivery): Promise<void> {
    const { path, subject: genericSubject } = CREDENTIAL_MAIL[delivery.purpose];
    // Concatenated rather than `new URL(path, base)`: a leading-slash path is
    // absolute, so resolving it against a base would silently drop any subpath
    // the frontend is mounted under. URL still owns the query encoding.
    const link = new URL(`${this.appBaseUrl.replace(/\/+$/, '')}${path}`);
    link.searchParams.set('token', delivery.token);
    const expiresAt = delivery.expiresAt.toISOString();
    const { subject, text, html } = delivery.invitation
      ? this.invitationContent(
          delivery.invitation,
          link.href,
          delivery.expiresAt,
        )
      : {
          subject: genericSubject,
          text: `${genericSubject}\n\n${link.href}\n\nThe link expires at ${expiresAt} and can be used once.`,
          html: `<p>${genericSubject}</p><p><a href="${link.href}">Continue</a></p><p>The link expires at ${expiresAt} and can be used once.</p>`,
        };

    try {
      const sent = await this.mailer.send({
        to: delivery.email,
        subject,
        text,
        html,
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

  private invitationContent(
    invitation: NonNullable<CredentialDelivery['invitation']>,
    href: string,
    expiresAt: Date,
  ): { subject: string; text: string; html: string } {
    const { spaceName, inviterName } = invitation;
    const role = ROLE_LABEL[invitation.role];
    const expiry = formatDate(expiresAt);
    // The subject is a header, not HTML: it takes the raw names.
    const subject = `${inviterName} te invitó a ${spaceName} en Tu Seguridad`;
    return {
      subject,
      text: `${inviterName} te invitó a ${spaceName} en Tu Seguridad.\n\nRol: ${role}\n\nVer invitación: ${href}\n\nLa invitación vence el ${expiry}.`,
      html: `<p><strong>${escapeHtml(inviterName)}</strong> te invitó a <strong>${escapeHtml(spaceName)}</strong> en Tu Seguridad.</p><p>Rol: ${role}</p><p><a href="${href}">Ver invitación</a></p><p>La invitación vence el ${expiry}.</p>`,
    };
  }
}
