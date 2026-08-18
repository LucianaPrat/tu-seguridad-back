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
   * Transport only: the gateway authenticates the socket and fans a payload
   * out. What an alert looks like on the wire belongs to the alert-event
   * domain, which calls this with its own DTO.
   */
  broadcast(event: string, payload: unknown): void {
    this.server.emit(event, payload);
  }
}
