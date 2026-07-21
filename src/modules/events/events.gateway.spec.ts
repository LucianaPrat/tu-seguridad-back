import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { EventsGateway } from './events.gateway';

describe('EventsGateway', () => {
  const secret = 'gateway-test-secret';

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

  it('accepts a valid token and delivers a broadcast zone-event within 1s', (done) => {
    const token = jwtService.sign({
      sub: 1,
      email: 'admin@example.com',
      role: 'admin',
    });
    const client = connect(token);

    client.on('connect', () => {
      client.once('zone-event', (payload: { eventId: string }) => {
        expect(payload).toEqual({ eventId: 'evt-1' });
        client.close();
        done();
      });

      gateway.broadcastZoneEvent({ eventId: 'evt-1' } as never);
    });
  }, 5000);
});
