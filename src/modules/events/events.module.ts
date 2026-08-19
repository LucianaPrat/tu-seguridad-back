import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsGateway } from './events.gateway';

/**
 * Only the socket transport for now. The alert-event query API and the payload
 * it broadcasts arrive with the alert-event domain; the setup-era `ZoneEvent`
 * controller, service and DTOs were removed with the schema they read.
 */
@Module({
  imports: [AuthModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
