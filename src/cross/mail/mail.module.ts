import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';

/**
 * Global because the transport is a process-wide resource and more than one
 * feature sends mail — credentials from `AuthModule`, alerts from
 * `EventsModule`. Two instances would mean two copies of the same env-driven
 * configuration.
 */
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailModule {}
