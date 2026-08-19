import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AlertEventsController } from './alert-events.controller';
import { AlertEventsService } from './alert-events.service';
import { EventsGateway } from './events.gateway';

/**
 * The alert-event domain: the history API, the delivery fan-out, the inbound
 * acknowledgement, and the socket transport that carries a new alert to the
 * space it belongs to. The detection pipeline calls `AlertEventsService.record`;
 * nothing else writes an event.
 */
@Module({
  imports: [AuthModule],
  controllers: [AlertEventsController],
  providers: [EventsGateway, AlertEventsService],
  exports: [AlertEventsService],
})
export class EventsModule {}
