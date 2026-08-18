import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvNames } from '../../cross/common/constants';
import {
  CredentialDelivery,
  CredentialDeliveryPort,
} from './credential-delivery.port';

/**
 * The placeholder delivery channel until a mail provider is chosen (deferred by
 * the data-model plan). Outside development it records that a credential was
 * issued and to whom — never the credential itself.
 *
 * In development it prints the raw token, because otherwise no local operator can
 * accept an invitation or finish a reset and the flows cannot be smoke-tested at
 * all. This is deliberately gated on `NODE_ENV === 'development'`: production and
 * test both take the redacted branch, so no fixture or shipped log can carry a
 * usable token.
 */
@Injectable()
export class LoggedCredentialDeliveryService implements CredentialDeliveryPort {
  private readonly logger = new Logger(LoggedCredentialDeliveryService.name);
  private readonly isDevelopment: boolean;

  constructor(configService: ConfigService) {
    this.isDevelopment =
      configService.get<string>(EnvNames.NODE_ENV) === 'development';
  }

  deliver(delivery: CredentialDelivery): Promise<void> {
    if (this.isDevelopment) {
      // Interpolated into the message on purpose: a structured field named
      // `token` is redacted by the logger's canonical sensitive-field list.
      this.logger.warn(
        `[development only] ${delivery.purpose} credential for ${delivery.email}: ${delivery.token} (expires ${delivery.expiresAt.toISOString()})`,
      );
      return Promise.resolve();
    }

    this.logger.log({
      msg: 'credential delivery pending a provider',
      purpose: delivery.purpose,
      recipient: delivery.email,
      expiresAt: delivery.expiresAt.toISOString(),
    });
    return Promise.resolve();
  }
}
