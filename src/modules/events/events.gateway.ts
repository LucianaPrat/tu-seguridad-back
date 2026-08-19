import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { EnvNames } from '../../cross/common/constants';
import type { JwtPayload } from '../../cross/common/jwt-payload.type';

/** The one message the namespace emits. Clients subscribe to it by name. */
export const ALERT_EVENT_MESSAGE = 'alert-event';

const spaceRoom = (spaceId: string) => `space:${spaceId}`;

@Injectable()
@WebSocketGateway({ namespace: 'events' })
export class EventsGateway implements OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
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
