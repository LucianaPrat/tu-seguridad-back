import { io, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { authAs, loginAs } from './utils/auth-as';
import {
  bootstrapE2eApp,
  E2eContext,
  ensureAdminSeeded,
} from './utils/bootstrap-e2e-app';
import { seedTenant } from './utils/seed-tenant';
import { TINY_JPEG } from './utils/tiny-jpeg';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface CameraBody {
  id: string;
}

interface AlertEventBody {
  id: string;
  cameraId: string | null;
  zoneId: string | null;
  cameraLabel: string;
  alertType: string;
  detectedAt: string;
  snapshotUrl: string | null;
  acknowledgedAt: string | null;
  acknowledgedByUserId: number | null;
}

interface AlertEventPageBody {
  items: AlertEventBody[];
  nextCursor: string | null;
}

interface DeliveryBody {
  id: string;
  channel: string;
  recipientUserId: number;
  status: string;
  inboundReceivedAt: string | null;
}

/** Anchor in the middle of the frame; the detector reports [0,1] coordinates. */
const CENTER = { x: 0.5, y: 0.5 };

describe('Alert events (e2e)', () => {
  let ctx: E2eContext;
  let token: string;
  let camera: CameraBody;
  let adminUserId: number;
  let spaceId: string;

  beforeAll(async () => {
    ctx = await bootstrapE2eApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    const admin = await ensureAdminSeeded(ctx.prisma);
    adminUserId = admin.userId;
    spaceId = admin.spaceId;
    token = await authAs(ctx.httpServer);

    ctx.fakeDvrClient.reachable = true;
    ctx.fakeDvrClient.channels = [
      {
        externalId: 'ch1',
        name: 'Channel 1',
        location: 'Gate',
        status: 'online',
      },
    ];
    ctx.fakeFaceAuthClient.response = {
      personsDetected: true,
      imageWidth: 1920,
      imageHeight: 1080,
      persons: [
        {
          detScore: 0.9,
          bbox: { topLeft: CENTER, bottomRight: CENTER },
          bboxNorm: { topLeft: CENTER, bottomRight: CENTER },
          anchor: CENTER,
        },
      ],
    };

    await request(ctx.httpServer).put('/api/v1/dvr').set(auth()).send({
      url: 'http://192.168.1.10:8000',
      username: 'dvr-admin',
      password: 'dvr-password',
      timezone: 'UTC',
    });
    const cameras = await request(ctx.httpServer)
      .get('/api/v1/cameras')
      .set(auth());
    camera = typedBody<CameraBody[]>(cameras)[0];
    await request(ctx.httpServer)
      .put(`/api/v1/cameras/${camera.id}`)
      .set(auth())
      .send({ monitorMode: 'full', alertType: 'intruder' });
  });

  function auth(bearer = token) {
    return { Authorization: `Bearer ${bearer}` };
  }

  /** Two frames: the occupancy engine needs its enter threshold satisfied. */
  async function raiseOneAlert(): Promise<void> {
    for (let frame = 0; frame < 2; frame += 1) {
      await request(ctx.httpServer)
        .post(`/api/v1/cameras/${camera.id}/analyze`)
        .set(auth())
        .attach('file', TINY_JPEG, 'frame.jpg');
    }
  }

  /** History rows written straight to the database, for the paging cases. */
  async function seedEvents(count: number, detectedAt: Date): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await ctx.prisma.alertEvent.create({
        data: {
          spaceId,
          cameraId: camera.id,
          cameraLabelSnapshot: `Seeded ${index}`,
          alertType: 'suspicious',
          detectedAt,
        },
      });
    }
  }

  it('records a detection as history with its snapshot and plans its deliveries', async () => {
    await raiseOneAlert();

    const page = typedBody<AlertEventPageBody>(
      await request(ctx.httpServer).get('/api/v1/events').set(auth()),
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      cameraId: camera.id,
      zoneId: null,
      cameraLabel: 'Channel 1 – Gate',
      alertType: 'intruder',
      acknowledgedAt: null,
      acknowledgedByUserId: null,
    });
    expect(page.nextCursor).toBeNull();

    // The frame is reachable only through the authenticated snapshot route.
    const snapshotUrl = page.items[0].snapshotUrl;
    expect(snapshotUrl).toEqual(expect.any(String));
    const bytes = await request(ctx.httpServer)
      .get(snapshotUrl as string)
      .set(auth());
    expect(bytes.status).toBe(200);

    // Routing defaults enable email for both alert types, and the seeded admin
    // is an active member who opted in.
    const deliveries = typedBody<DeliveryBody[]>(
      await request(ctx.httpServer)
        .get(`/api/v1/events/${page.items[0].id}/deliveries`)
        .set(auth()),
    );
    expect(deliveries).toEqual([
      expect.objectContaining({
        channel: 'email',
        recipientUserId: adminUserId,
        status: 'pending',
        inboundReceivedAt: null,
      }),
    ]);
    expect(JSON.stringify(deliveries)).not.toContain('correlationId');
  });

  it('keeps history readable after the camera it names is logically deleted', async () => {
    await raiseOneAlert();

    const deleted = await request(ctx.httpServer)
      .delete(`/api/v1/cameras/${camera.id}`)
      .set(auth());
    expect(deleted.status).toBe(200);
    expect(
      typedBody<CameraBody[]>(
        await request(ctx.httpServer).get('/api/v1/cameras').set(auth()),
      ),
    ).toEqual([]);

    const page = typedBody<AlertEventPageBody>(
      await request(ctx.httpServer).get('/api/v1/events').set(auth()),
    );
    expect(page.items[0]).toMatchObject({
      cameraLabel: 'Channel 1 – Gate',
      alertType: 'intruder',
    });
  });

  it('pages the history with a cursor and filters it by type and date', async () => {
    const detectedAt = new Date('2026-08-01T10:00:00.000Z');
    await seedEvents(3, detectedAt);

    const first = typedBody<AlertEventPageBody>(
      await request(ctx.httpServer).get('/api/v1/events?limit=2').set(auth()),
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = typedBody<AlertEventPageBody>(
      await request(ctx.httpServer)
        .get(`/api/v1/events?limit=2&cursor=${first.nextCursor as string}`)
        .set(auth()),
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((event) => event.id)).size,
    ).toBe(3);

    const filtered = typedBody<AlertEventPageBody>(
      await request(ctx.httpServer)
        .get('/api/v1/events?alertType=intruder')
        .set(auth()),
    );
    expect(filtered.items).toEqual([]);

    const fromTomorrow = typedBody<AlertEventPageBody>(
      await request(ctx.httpServer)
        .get('/api/v1/events?from=2026-08-02T00:00:00.000Z')
        .set(auth()),
    );
    expect(fromTomorrow.items).toEqual([]);
  });

  it('rejects a cursor it did not issue and a page size over the ceiling', async () => {
    const badCursor = await request(ctx.httpServer)
      .get('/api/v1/events?cursor=not-a-cursor')
      .set(auth());
    expect(badCursor.status).toBe(400);

    const badLimit = await request(ctx.httpServer)
      .get('/api/v1/events?limit=1000')
      .set(auth());
    expect(badLimit.status).toBe(400);
  });

  it('answers a Space B token with nothing of Space A history', async () => {
    await raiseOneAlert();
    const eventId = typedBody<AlertEventPageBody>(
      await request(ctx.httpServer).get('/api/v1/events').set(auth()),
    ).items[0].id;

    const other = await seedTenant(
      ctx.prisma,
      'other-space@example.com',
      'Other space',
    );
    const otherToken = await loginAs(
      ctx.httpServer,
      other.email,
      other.password,
    );

    const page = await request(ctx.httpServer)
      .get('/api/v1/events')
      .set(auth(otherToken));
    expect(page.status).toBe(200);
    expect(typedBody<AlertEventPageBody>(page).items).toEqual([]);

    const detail = await request(ctx.httpServer)
      .get(`/api/v1/events/${eventId}`)
      .set(auth(otherToken));
    expect(detail.status).toBe(404);

    const deliveries = await request(ctx.httpServer)
      .get(`/api/v1/events/${eventId}/deliveries`)
      .set(auth(otherToken));
    expect(deliveries.status).toBe(404);
  });

  it('acknowledges an event from one provider callback and stays idempotent', async () => {
    await raiseOneAlert();
    const delivery = await ctx.prisma.eventDelivery.findFirstOrThrow();

    const acknowledge = (correlationId: string) =>
      request(ctx.httpServer)
        .post('/api/v1/events/acknowledgements')
        .send({ correlationId });

    // Unauthenticated on purpose: the correlation id is the credential.
    const first = await acknowledge(delivery.correlationId);
    expect(first.status).toBe(202);
    expect(typedBody<{ accepted: boolean }>(first)).toEqual({ accepted: true });

    const acknowledged = await ctx.prisma.alertEvent.findFirstOrThrow();
    expect(acknowledged.acknowledgedByUserId).toBe(adminUserId);
    expect(acknowledged.acknowledgedAt).not.toBeNull();
    await expect(
      ctx.prisma.eventDelivery.findFirstOrThrow(),
    ).resolves.toMatchObject({ status: 'delivered' });

    const repeat = await acknowledge(delivery.correlationId);
    const unknown = await acknowledge('never-issued-correlation-id');
    expect(repeat.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(typedBody<{ accepted: boolean }>(repeat)).toEqual(
      typedBody<{ accepted: boolean }>(unknown),
    );

    const unchanged = await ctx.prisma.alertEvent.findFirstOrThrow();
    expect(unchanged.acknowledgedAt).toEqual(acknowledged.acknowledgedAt);
  });

  it('delivers a new alert over the socket to its own space only', async () => {
    const other = await seedTenant(
      ctx.prisma,
      'socket-other@example.com',
      'Socket other space',
    );

    const ownSpace = await connectAndCollect(token);
    const otherSpace = await connectAndCollect(
      await loginAs(ctx.httpServer, other.email, other.password),
    );

    await raiseOneAlert();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(ownSpace.received).toEqual([
      expect.objectContaining({
        cameraLabel: 'Channel 1 – Gate',
        alertType: 'intruder',
      }),
    ]);
    expect(otherSpace.received).toEqual([]);
    ownSpace.close();
    otherSpace.close();
  });

  async function connectAndCollect(bearer: string): Promise<{
    received: AlertEventBody[];
    close: () => void;
  }> {
    const socket: ClientSocket = io(`${ctx.baseUrl}/events`, {
      auth: { token: bearer },
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
    const received: AlertEventBody[] = [];
    socket.on('alert-event', (payload: AlertEventBody) => {
      received.push(payload);
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
    return { received, close: () => socket.close() };
  }
});
