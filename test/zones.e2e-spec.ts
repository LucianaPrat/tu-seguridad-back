import request from 'supertest';
import { authAs, loginAs } from './utils/auth-as';
import {
  bootstrapE2eApp,
  E2eContext,
  ensureAdminSeeded,
  SeededAdmin,
} from './utils/bootstrap-e2e-app';
import { seedMember, seedTenant } from './utils/seed-tenant';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface CameraBody {
  id: string;
  externalId: string;
  isConfigured: boolean;
  monitorMode: string;
}

interface ZoneBody {
  id: string;
  cameraId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alertType: string;
}

interface ErrorBody {
  code: string;
  message: string;
}

describe('Monitor zones (e2e)', () => {
  let ctx: E2eContext;
  let admin: SeededAdmin;
  let token: string;
  let camera: CameraBody;

  beforeAll(async () => {
    ctx = await bootstrapE2eApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    admin = await ensureAdminSeeded(ctx.prisma);
    token = await authAs(ctx.httpServer);
    ctx.fakeDvrClient.reachable = true;
    ctx.fakeDvrClient.channels = [
      { externalId: 'ch1', name: 'Channel 1', status: 'online' },
    ];

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
      .send({ monitorMode: 'partial' });
  });

  function auth(bearer = token) {
    return { Authorization: `Bearer ${bearer}` };
  }

  function createZone(body: Record<string, unknown>, bearer = token) {
    return request(ctx.httpServer)
      .post(`/api/v1/cameras/${camera.id}/zones`)
      .set(auth(bearer))
      .send(body);
  }

  const validZone = {
    x: 10.5,
    y: 20,
    width: 30,
    height: 40,
    alertType: 'intruder',
  };

  it('creates a percentage rectangle and returns it as numbers', async () => {
    const res = await createZone(validZone);

    expect(res.status).toBe(201);
    expect(typedBody<ZoneBody>(res)).toMatchObject({
      cameraId: camera.id,
      x: 10.5,
      y: 20,
      width: 30,
      height: 40,
      alertType: 'intruder',
    });
  });

  it('rejects a rectangle that leaves the frame', async () => {
    const res = await createZone({ ...validZone, x: 80, width: 30 });

    expect(res.status).toBe(400);
    expect(typedBody<ErrorBody>(res).code).toBe('INVALID_ZONE');
  });

  it('rejects coordinates outside 0..100 and finer than two decimals', async () => {
    const outOfRange = await createZone({ ...validZone, y: 120 });
    expect(outOfRange.status).toBe(400);
    expect(typedBody<ErrorBody>(outOfRange).code).toBe('VALIDATION_ERROR');

    const tooPrecise = await createZone({ ...validZone, x: 10.555 });
    expect(tooPrecise.status).toBe(400);
    expect(typedBody<ErrorBody>(tooPrecise).code).toBe('VALIDATION_ERROR');
  });

  it('arms the camera with its first zone and disarms it with the last', async () => {
    const created = await createZone(validZone);
    const zone = typedBody<ZoneBody>(created);

    const armed = await request(ctx.httpServer)
      .get(`/api/v1/cameras/${camera.id}`)
      .set(auth());
    expect(typedBody<CameraBody>(armed).isConfigured).toBe(true);

    const deleted = await request(ctx.httpServer)
      .delete(`/api/v1/zones/${zone.id}`)
      .set(auth());
    expect(deleted.status).toBe(200);

    const list = await request(ctx.httpServer)
      .get(`/api/v1/cameras/${camera.id}/zones`)
      .set(auth());
    expect(typedBody<ZoneBody[]>(list)).toHaveLength(0);

    const disarmed = await request(ctx.httpServer)
      .get(`/api/v1/cameras/${camera.id}`)
      .set(auth());
    expect(typedBody<CameraBody>(disarmed).isConfigured).toBe(false);
  });

  it('validates the merged rectangle on a partial update', async () => {
    const zone = typedBody<ZoneBody>(await createZone(validZone));

    const res = await request(ctx.httpServer)
      .put(`/api/v1/zones/${zone.id}`)
      .set(auth())
      .send({ x: 90 });

    expect(res.status).toBe(400);
    expect(typedBody<ErrorBody>(res).code).toBe('INVALID_ZONE');
  });

  it("hides another space's zone behind NOT_FOUND", async () => {
    const zone = typedBody<ZoneBody>(await createZone(validZone));
    const other = await seedTenant(
      ctx.prisma,
      'zones-other@example.com',
      'Other space',
    );
    const otherToken = await loginAs(
      ctx.httpServer,
      other.email,
      other.password,
    );

    const read = await request(ctx.httpServer)
      .get(`/api/v1/zones/${zone.id}`)
      .set(auth(otherToken));
    expect(read.status).toBe(404);

    const deleted = await request(ctx.httpServer)
      .delete(`/api/v1/zones/${zone.id}`)
      .set(auth(otherToken));
    expect(deleted.status).toBe(404);
  });

  it('lets a member read zones but not draw them', async () => {
    await createZone(validZone);
    await seedMember(ctx.prisma, admin.spaceId, 'zones-member@example.com');
    const memberToken = await loginAs(
      ctx.httpServer,
      'zones-member@example.com',
      'e2e-password-1234',
    );

    const list = await request(ctx.httpServer)
      .get(`/api/v1/cameras/${camera.id}/zones`)
      .set(auth(memberToken));
    expect(list.status).toBe(200);

    const created = await createZone(validZone, memberToken);
    expect(created.status).toBe(403);
  });
});
