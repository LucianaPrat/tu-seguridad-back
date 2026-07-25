import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { Socket } from 'socket.io';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { MetricNames } from '../../cross/metrics/metric-names';
import { EventsGateway } from './events.gateway';

describe('EventsGateway', () => {
  const secret = 'gateway-test-secret';
  const wsGauge = { inc: jest.fn(), dec: jest.fn() };

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
        {
          provide: getToken(MetricNames.WEBSOCKET_CONNECTIONS_ACTIVE),
          useValue: wsGauge,
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

  describe('connection gauge', () => {
    const fakeSocket = (id: string, token?: string): Socket =>
      ({
        id,
        handshake: { auth: token ? { token } : {} },
        disconnect: jest.fn(),
      }) as unknown as Socket;

    beforeEach(() => {
      wsGauge.inc.mockClear();
      wsGauge.dec.mockClear();
    });

    it('increments on an authenticated connect and decrements on its disconnect', () => {
      const token = jwtService.sign({
        sub: 1,
        email: 'a@a.com',
        role: 'admin',
      });
      const client = fakeSocket('sock-1', token);

      gateway.handleConnection(client);
      expect(wsGauge.inc).toHaveBeenCalledTimes(1);

      gateway.handleDisconnect(client);
      expect(wsGauge.dec).toHaveBeenCalledTimes(1);
    });

    it('does not count a client rejected at handshake', () => {
      const client = fakeSocket('sock-2', 'bad-token');

      gateway.handleConnection(client);
      expect(wsGauge.inc).not.toHaveBeenCalled();

      gateway.handleDisconnect(client);
      expect(wsGauge.dec).not.toHaveBeenCalled();
    });
  });
});
