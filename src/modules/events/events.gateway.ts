import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';
import { Server, Socket } from 'socket.io';
import { EnvNames } from '../../cross/common/constants';
import { MetricNames } from '../../cross/metrics/metric-names';
import { ZoneEventDto } from './dto/zone-event.dto';

@Injectable()
@WebSocketGateway({ namespace: 'events' })
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(EventsGateway.name);
  // Client ids that passed auth, so the gauge only counts (and decrements)
  // genuinely connected clients — never the ones rejected at handshake.
  private readonly authenticated = new Set<string>();

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectMetric(MetricNames.WEBSOCKET_CONNECTIONS_ACTIVE)
    private readonly wsConnections: Gauge<string>,
  ) {}

  handleConnection(client: Socket): void {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      this.logger.warn(`Client ${client.id} connected without a token`);
      client.disconnect(true);
      return;
    }

    try {
      this.jwtService.verify(token, {
        secret: this.configService.get<string>(EnvNames.JWT_SECRET),
      });
    } catch {
      this.logger.warn(`Client ${client.id} rejected: invalid token`);
      client.disconnect(true);
      return;
    }

    this.authenticated.add(client.id);
    this.wsConnections.inc();
  }

  handleDisconnect(client: Socket): void {
    if (this.authenticated.delete(client.id)) {
      this.wsConnections.dec();
    }
  }

  // On shutdown (SIGINT/SIGTERM via enableShutdownHooks), disconnect every
  // client cleanly so they get a `disconnect` event instead of a dropped socket.
  // Runs before PrismaService's teardown thanks to Nest's reverse destroy order.
  onModuleDestroy(): void {
    if (this.server) {
      this.server.disconnectSockets(true);
    }
  }

  broadcastZoneEvent(event: ZoneEventDto): void {
    this.server.emit('zone-event', event);
  }
}
