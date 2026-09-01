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
import type { JwtPayload } from '../../cross/common/jwt-payload.type';
import { MetricNames } from '../../cross/metrics/metric-names';

/** The one message the namespace emits. Clients subscribe to it by name. */
export const ALERT_EVENT_MESSAGE = 'alert-event';

const spaceRoom = (spaceId: string) => `space:${spaceId}`;

@Injectable()
@WebSocketGateway({ namespace: 'events' })
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(EventsGateway.name);
  // Which sockets the gauge is actually counting. A rejected handshake still
  // fires `disconnect`, so decrementing on every disconnect would drift the
  // gauge negative one refused token at a time.
  private readonly counted = new Set<string>();

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectMetric(MetricNames.WEBSOCKET_CONNECTIONS_ACTIVE)
    private readonly wsConnections: Gauge<string>,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      this.logger.warn(`Client ${client.id} connected without a token`);
      client.disconnect(true);
      return;
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>(EnvNames.JWT_SECRET),
      });
    } catch {
      this.logger.warn(`Client ${client.id} rejected: invalid token`);
      client.disconnect(true);
      return;
    }

    // A socket is subscribed to its own space and nothing else. Without the
    // room, `server.emit` would fan every space's alerts out to every connected
    // client — the one place in this API where tenant scoping is not a `where`
    // clause, and so the one place it has to be spelled out.
    if (!payload.spaceId) {
      this.logger.warn(`Client ${client.id} rejected: token carries no space`);
      client.disconnect(true);
      return;
    }
    // `join` is synchronous on the in-memory adapter and a promise on a
    // clustered one; awaiting covers both.
    await client.join(spaceRoom(payload.spaceId));

    // Counted here, past every rejection: a socket that carried no token, an
    // invalid one, or a token with no space is gone by now, and counting it
    // above would report subscribers this gateway will never emit to.
    this.counted.add(client.id);
    this.wsConnections.inc();
  }

  handleDisconnect(client: Socket): void {
    if (this.counted.delete(client.id)) {
      this.wsConnections.dec();
    }
  }

  // On shutdown (SIGINT/SIGTERM via enableShutdownHooks), disconnect every
  // client cleanly so they get a `disconnect` event instead of a dropped socket.
  // Runs before database teardown thanks to Nest's reverse destroy order.
  onModuleDestroy(): void {
    if (this.server) {
      this.server.disconnectSockets(true);
    }
  }

  /**
   * Transport only: the gateway authenticates the socket and fans a payload out
   * to one space. What an alert looks like on the wire belongs to the
   * alert-event domain, which calls this with its own DTO.
   */
  broadcast(spaceId: string, event: string, payload: unknown): void {
    this.server.to(spaceRoom(spaceId)).emit(event, payload);
  }
}
