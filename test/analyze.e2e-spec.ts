import { io, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { bootstrapE2eApp, E2eContext } from './utils/bootstrap-e2e-app';
import { authAs } from './utils/auth-as';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface AnalyzeResultBody {
  persons: unknown[];
  eventsEmitted: { eventType: string }[];
}

describe('Analyze pipeline (e2e)', () => {
  let ctx: E2eContext;
  let token: string;

  beforeAll(async () => {
    ctx = await bootstrapE2eApp();
    token = await authAs(ctx.httpServer);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    await request(ctx.httpServer).post('/api/v1/cameras').set(auth()).send({
      id: 'camera_analyze_e2e',
      name: 'Analyze E2e Cam',
      snapshotUrl: 'http://dvr.local/snap.jpg',
      confidenceThreshold: 0.5,
    });
    await request(ctx.httpServer)
      .post('/api/v1/cameras/camera_analyze_e2e/zones')
      .set(auth())
      .send({
        id: 'zone_analyze_e2e',
        name: 'Analyze E2e Zone',
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      });
  });

  function auth() {
    return { Authorization: `Bearer ${token}` };
  }

  it('runs the full pipeline and broadcasts the confirmed event over the WS gateway', async () => {
    ctx.fakeFaceAuthClient.response = {
      personsDetected: true,
      imageWidth: 100,
      imageHeight: 100,
      persons: [
        {
          detScore: 0.9,
          bbox: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 10, y: 10 } },
          bboxNorm: {
            topLeft: { x: 0, y: 0 },
            bottomRight: { x: 0.1, y: 0.1 },
          },
          anchor: { x: 0.5, y: 0.5 },
        },
      ],
    };

    const client: ClientSocket = io(`${ctx.baseUrl}/events`, {
      auth: { token },
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => client.on('connect', () => resolve()));
    const zoneEventPromise = new Promise((resolve) => {
      client.once('zone-event', resolve);
    });

    const first = await request(ctx.httpServer)
      .post('/api/v1/cameras/camera_analyze_e2e/analyze')
      .set(auth())
      .attach('file', Buffer.from('fake-image-bytes'), 'snapshot.jpg');
    const firstBody = typedBody<AnalyzeResultBody>(first);
    expect(first.status).toBe(201);
    expect(firstBody.persons).toHaveLength(1);
    expect(firstBody.eventsEmitted).toEqual([]);

    const second = await request(ctx.httpServer)
      .post('/api/v1/cameras/camera_analyze_e2e/analyze')
      .set(auth())
      .attach('file', Buffer.from('fake-image-bytes'), 'snapshot.jpg');
    const secondBody = typedBody<AnalyzeResultBody>(second);
    expect(secondBody.eventsEmitted).toHaveLength(1);
    expect(secondBody.eventsEmitted[0].eventType).toBe('PERSON_ENTERED_ZONE');

    const received = await zoneEventPromise;
    expect(received).toMatchObject({ eventType: 'PERSON_ENTERED_ZONE' });

    const listed = await request(ctx.httpServer)
      .get('/api/v1/events')
      .set(auth());
    expect(typedBody<unknown[]>(listed)).toHaveLength(1);

    client.close();
  }, 10000);
});
