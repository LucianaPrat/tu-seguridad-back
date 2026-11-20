import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvNames } from '../../cross/common/constants';
import { MailerService } from '../../cross/mail/mailer.service';
import type { Locale, SpaceMemberRole } from '@prisma/client';
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
const CREDENTIAL_PATH: Record<DeliveredCredentialPurpose, string> = {
  invitation: '/invitations/accept',
  magic_link: '/auth/magic',
  password_reset: '/auth/reset-password',
};

// One small copy table per mail; `{ es, en }` keyed by the recipient's locale.
const GENERIC_COPY: Record<
  Exclude<DeliveredCredentialPurpose, 'invitation'>,
  Record<
    Locale,
    { subject: string; button: string; expiry: (at: string) => string }
  >
> = {
  magic_link: {
    en: {
      subject: 'Your Tu Seguridad sign-in link',
      button: 'Continue',
      expiry: (at) => `The link expires at ${at} and can be used once.`,
    },
    es: {
      subject: 'Tu enlace de acceso a Tu Seguridad',
      button: 'Continuar',
      expiry: (at) => `El enlace vence el ${at} y se puede usar una sola vez.`,
    },
  },
  password_reset: {
    en: {
      subject: 'Reset your Tu Seguridad password',
      button: 'Continue',
      expiry: (at) => `The link expires at ${at} and can be used once.`,
    },
    es: {
      subject: 'Restablece tu contraseña de Tu Seguridad',
      button: 'Continuar',
      expiry: (at) => `El enlace vence el ${at} y se puede usar una sola vez.`,
    },
  },
};

const INVITATION_COPY: Record<
  Locale,
  {
    subject: (inviter: string, space: string) => string;
    roles: Record<SpaceMemberRole, string>;
    intro: (inviter: string, space: string) => string;
    role: string;
    button: string;
    expiry: (date: string) => string;
  }
> = {
  es: {
    subject: (inviter, space) =>
      `${inviter} te invitó a ${space} en Tu Seguridad`,
    roles: {
      admin: 'Administrador',
      collaborator: 'Colaborador',
      guest: 'Invitado',
    },
    intro: (inviter, space) =>
      `${inviter} te invitó a ${space} en Tu Seguridad.`,
    role: 'Rol',
    button: 'Ver invitación',
    expiry: (date) => `La invitación vence el ${date}.`,
  },
  en: {
    subject: (inviter, space) =>
      `${inviter} invited you to ${space} on Tu Seguridad`,
    roles: {
      admin: 'Administrator',
      collaborator: 'Collaborator',
      guest: 'Guest',
    },
    intro: (inviter, space) =>
      `${inviter} invited you to ${space} on Tu Seguridad.`,
    role: 'Role',
    button: 'View invitation',
    expiry: (date) => `Expires on ${date}.`,
  },
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
function formatDate(date: Date, locale: Locale): string {
  const [year, month, day] = date.toISOString().slice(0, 10).split('-');
  return locale === 'en'
    ? `${month}/${day}/${year}`
    : `${day}/${month}/${year}`;
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
    const path = CREDENTIAL_PATH[delivery.purpose];
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
          delivery.locale,
        )
      : this.genericContent(delivery, link.href, expiresAt);

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

  private genericContent(
    delivery: CredentialDelivery,
    href: string,
    expiresAt: string,
  ): { subject: string; text: string; html: string } {
    const copy =
      GENERIC_COPY[delivery.purpose as keyof typeof GENERIC_COPY][
        delivery.locale
      ];
    const expiry = copy.expiry(expiresAt);
    return {
      subject: copy.subject,
      text: `${copy.subject}\n\n${href}\n\n${expiry}`,
      html: `<p>${copy.subject}</p><p><a href="${href}">${copy.button}</a></p><p>${expiry}</p>`,
    };
  }

  private invitationContent(
    invitation: NonNullable<CredentialDelivery['invitation']>,
    href: string,
    expiresAt: Date,
    locale: Locale,
  ): { subject: string; text: string; html: string } {
    const { spaceName, inviterName } = invitation;
    const copy = INVITATION_COPY[locale];
    const role = copy.roles[invitation.role];
    const expiry = copy.expiry(formatDate(expiresAt, locale));
    const safeInviter = escapeHtml(inviterName);
    const safeSpace = escapeHtml(spaceName);
    // The subject is a header, not HTML: it takes the raw names.
    return {
      subject: copy.subject(inviterName, spaceName),
      text: `${copy.intro(inviterName, spaceName)}\n\n${copy.role}: ${role}\n\n${copy.button}: ${href}\n\n${expiry}`,
      html: `<p>${copy.intro(`<strong>${safeInviter}</strong>`, `<strong>${safeSpace}</strong>`)}</p><p>${copy.role}: ${role}</p><p><a href="${href}">${copy.button}</a></p><p>${expiry}</p>`,
    };
  }
}
