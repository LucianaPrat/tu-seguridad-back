import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { ALERT_EVENT_MESSAGE, EventsGateway } from './events.gateway';

describe('EventsGateway', () => {
  const secret = 'gateway-test-secret';
  const spaceA = 'space-a-uuid';
  const spaceB = 'space-b-uuid';

  let app: INestApplication;
  let jwtService: JwtService;
  let gateway: EventsGateway;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EventsGateway,
        { provide: JwtService, useValue: new JwtService({ secret }) },
        {
          provide: ConfigService,
          useValue: { get: () => secret },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    jwtService = moduleRef.get(JwtService);
    gateway = moduleRef.get(EventsGateway);

    await app.listen(0);
    const httpServer = app.getHttpServer() as Server;
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${address.port}/events`;
  });

  afterAll(async () => {
    await app.close();
  });

  function connect(token?: string): ClientSocket {
    return io(baseUrl, {
      auth: token ? { token } : {},
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
  }

  function tokenFor(spaceId?: string): string {
    return jwtService.sign({
      sub: 1,
      email: 'admin@example.com',
      role: 'admin',
      profileCompleted: true,
      ...(spaceId ? { spaceId } : {}),
    });
  }

  it('disconnects a client that connects with a bad token', (done) => {
    const client = connect('garbage-token');

    client.on('disconnect', () => {
      client.close();
      done();
    });
  }, 5000);

  it('disconnects a client that connects with no token', (done) => {
    const client = connect();

    client.on('disconnect', () => {
      client.close();
      done();
    });
  }, 5000);

  /**
   * A pre-tenant token verifies but names no space, so there is no room to put
   * the socket in. Broadcasts are addressed by space, so accepting it would
   * leave a connected client that either receives nothing or, on a future
   * `server.emit`, receives everything.
   */
  it('disconnects a client whose token carries no space', (done) => {
    const client = connect(tokenFor());

    client.on('disconnect', () => {
      client.close();
      done();
    });
  }, 5000);

  it('delivers a broadcast for the socket own space within 1s', (done) => {
    const client = connect(tokenFor(spaceA));

    client.on('connect', () => {
      client.once(ALERT_EVENT_MESSAGE, (payload: { id: string }) => {
        expect(payload).toEqual({ id: 'evt-1' });
        client.close();
        done();
      });

      gateway.broadcast(spaceA, ALERT_EVENT_MESSAGE, { id: 'evt-1' });
    });
  }, 5000);

  it('never delivers another space broadcast to this socket', (done) => {
    const client = connect(tokenFor(spaceA));

    client.on('connect', () => {
      client.once(ALERT_EVENT_MESSAGE, (payload: { id: string }) => {
        // Space B was broadcast first. Anything but the space A payload here
        // means the room is not scoping the fan-out.
        expect(payload).toEqual({ id: 'own-space' });
        client.close();
        done();
      });

      gateway.broadcast(spaceB, ALERT_EVENT_MESSAGE, { id: 'other-space' });
      gateway.broadcast(spaceA, ALERT_EVENT_MESSAGE, { id: 'own-space' });
    });
  }, 5000);

  it('disconnects connected clients cleanly on module destroy', (done) => {
    const client = connect(tokenFor(spaceA));

    client.on('connect', () => {
      client.on('disconnect', () => {
        client.close();
        done();
      });
      gateway.onModuleDestroy();
    });
  }, 5000);
});
