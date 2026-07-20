import request from 'supertest';
import { bootstrapE2eApp, E2eContext } from './utils/bootstrap-e2e-app';
import { authAs } from './utils/auth-as';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface ZoneBody {
  geometryVersion: number;
}

interface ValidateResultBody {
  valid: boolean;
  violations: unknown[];
}

describe('Zones (e2e)', () => {
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
      id: 'camera_zone_e2e',
      name: 'Zone E2e Cam',
      snapshotUrl: 'http://dvr.local/snap.jpg',
    });
  });

  function auth() {
    return { Authorization: `Bearer ${token}` };
  }

  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it('creates a zone, updates its polygon (bumps geometryVersion), then deletes it', async () => {
    const create = await request(ctx.httpServer)
      .post('/api/v1/cameras/camera_zone_e2e/zones')
      .set(auth())
      .send({ id: 'zone_e2e_lobby', name: 'Lobby', polygon: square });
    expect(create.status).toBe(201);
    expect(typedBody<ZoneBody>(create).geometryVersion).toBe(1);

    const update = await request(ctx.httpServer)
      .put('/api/v1/zones/zone_e2e_lobby')
      .set(auth())
      .send({
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0.5, y: 1 },
        ],
      });
    expect(update.status).toBe(200);
    expect(typedBody<ZoneBody>(update).geometryVersion).toBe(2);

    const remove = await request(ctx.httpServer)
      .delete('/api/v1/zones/zone_e2e_lobby')
      .set(auth());
    expect(remove.status).toBe(200);

    const afterDelete = await request(ctx.httpServer)
      .get('/api/v1/zones/zone_e2e_lobby')
      .set(auth());
    expect(afterDelete.status).toBe(404);
  });

  it('validate dry-run returns 200 with violations for a bad polygon, never an error', async () => {
    const res = await request(ctx.httpServer)
      .post('/api/v1/cameras/camera_zone_e2e/zones')
      .set(auth())
      .send({ id: 'zone_e2e_dryrun', name: 'Dry run zone', polygon: square })
      .then(() =>
        request(ctx.httpServer)
          .post('/api/v1/zones/zone_e2e_dryrun/validate')
          .set(auth())
          .send({
            polygon: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          }),
      );

    const body = typedBody<ValidateResultBody>(res);
    expect(res.status).toBe(200);
    expect(body.valid).toBe(false);
    expect(body.violations.length).toBeGreaterThan(0);
  });
});
