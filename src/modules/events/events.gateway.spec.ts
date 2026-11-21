import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { SpaceMemberAccessorService } from '../../data/accessors/space-member.accessor';
import { MetricNames } from '../../cross/metrics/metric-names';
import { ALERT_EVENT_MESSAGE, EventsGateway } from './events.gateway';

describe('EventsGateway', () => {
  const secret = 'gateway-test-secret';
  const spaceA = 'space-a-uuid';
  const spaceB = 'space-b-uuid';
  const spaceGuest = 'space-guest-uuid';

  let app: INestApplication;
  let jwtService: JwtService;
  let gateway: EventsGateway;
  let baseUrl: string;
  const wsConnections = { inc: jest.fn(), dec: jest.fn() };
  // Everyone is a member except the space named here.
  const spaceWithoutMember = 'space-without-member-uuid';
  const spaceMemberAccessor = {
    findBySpaceAndUser: jest.fn((spaceId: string) => {
      if (spaceId === spaceWithoutMember) return Promise.resolve(null);
      if (spaceId === spaceGuest) {
        return Promise.resolve({
          userId: 1,
          role: 'guest',
          menuAccess: [],
          cameraIds: ['cam-1'],
        });
      }
      return Promise.resolve({ userId: 1 });
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EventsGateway,
        { provide: JwtService, useValue: new JwtService({ secret }) },
        {
          provide: ConfigService,
          useValue: { get: () => secret },
        },
        { provide: SpaceMemberAccessorService, useValue: spaceMemberAccessor },
        {
          provide: getToken(MetricNames.WEBSOCKET_CONNECTIONS_ACTIVE),
          useValue: wsConnections,
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

  // `undefined` omits the key (a pre-tenant token); `null` is a session in no
  // space.
  function tokenFor(spaceId?: string | null): string {
    return jwtService.sign({
      sub: 1,
      email: 'admin@example.com',
      profileCompleted: true,
      ...(spaceId === undefined ? {} : { spaceId }),
    });
  }

  beforeEach(() => {
    wsConnections.inc.mockClear();
    wsConnections.dec.mockClear();
  });

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

  it('disconnects a client whose session is in no space', (done) => {
    const client = connect(tokenFor(null));

    client.on('disconnect', () => {
      client.close();
      done();
    });
  }, 5000);

  it('disconnects a client that is no longer a member of the token space', (done) => {
    const client = connect(tokenFor(spaceWithoutMember));

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

      gateway.broadcast(spaceA, null, ALERT_EVENT_MESSAGE, { id: 'evt-1' });
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

      gateway.broadcast(spaceB, null, ALERT_EVENT_MESSAGE, {
        id: 'other-space',
      });
      gateway.broadcast(spaceA, null, ALERT_EVENT_MESSAGE, { id: 'own-space' });
    });
  }, 5000);

  it('delivers a guest only the broadcasts of its own cameras', (done) => {
    const client = connect(tokenFor(spaceGuest));

    client.on('connect', () => {
      client.once(ALERT_EVENT_MESSAGE, (payload: { id: string }) => {
        // cam-2 and a camera-less event went first; either arriving here
        // means the guest is in the space room or a foreign camera room.
        expect(payload).toEqual({ id: 'own' });
        client.close();
        done();
      });

      gateway.broadcast(spaceGuest, 'cam-2', ALERT_EVENT_MESSAGE, { id: 'x' });
      gateway.broadcast(spaceGuest, null, ALERT_EVENT_MESSAGE, { id: 'none' });
      gateway.broadcast(spaceGuest, 'cam-1', ALERT_EVENT_MESSAGE, {
        id: 'own',
      });
    });
  }, 5000);

  it('delivers a non-guest the broadcast of any camera of its space', (done) => {
    const client = connect(tokenFor(spaceA));

    client.on('connect', () => {
      client.once(ALERT_EVENT_MESSAGE, (payload: { id: string }) => {
        expect(payload).toEqual({ id: 'cam-9' });
        client.close();
        done();
      });

      gateway.broadcast(spaceA, 'cam-9', ALERT_EVENT_MESSAGE, { id: 'cam-9' });
    });
  }, 5000);

  /**
   * Driven through the handlers rather than a real socket: the gauge is read
   * synchronously right after the call, with no handshake round trip to race
   * against another test's socket still connecting or closing.
   */
  describe('connection gauge', () => {
    function fakeSocket(
      id: string,
      token?: string,
    ): Parameters<EventsGateway['handleConnection']>[0] {
      return {
        id,
        handshake: { auth: token ? { token } : {} },
        join: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn(),
      } as never;
    }

    it('counts a socket that reached its room, and uncounts it once', async () => {
      const socket = fakeSocket('socket-1', tokenFor(spaceA));

      await gateway.handleConnection(socket);
      expect(wsConnections.inc).toHaveBeenCalledTimes(1);

      gateway.handleDisconnect(socket);
      gateway.handleDisconnect(socket);

      expect(wsConnections.dec).toHaveBeenCalledTimes(1);
    });

    /**
     * Every refused handshake still fires `disconnect`, so a gauge that
     * decremented on all of them would sink below zero one bad token at a time
     * and report negative subscribers.
     */
    it.each([
      ['no token', undefined],
      ['a token carrying no space', 'no-space'],
      ['an invalid token', 'garbage-token'],
    ])('never counts a socket refused for %s', async (_case, kind) => {
      const token =
        kind === 'no-space'
          ? tokenFor()
          : kind === undefined
            ? undefined
            : kind;
      const socket = fakeSocket('socket-refused', token);

      await gateway.handleConnection(socket);
      gateway.handleDisconnect(socket);

      expect(wsConnections.inc).not.toHaveBeenCalled();
      expect(wsConnections.dec).not.toHaveBeenCalled();
    });
  });

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
