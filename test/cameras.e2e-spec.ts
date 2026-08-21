import request from 'supertest';
import { authAs, loginAs } from './utils/auth-as';
import {
  bootstrapE2eApp,
  E2eContext,
  ensureAdminSeeded,
  SeededAdmin,
} from './utils/bootstrap-e2e-app';
import { E2E_PASSWORD, seedMember, seedTenant } from './utils/seed-tenant';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface CameraBody {
  id: string;
  externalId: string;
  name: string;
  isConfigured: boolean;
  isEnabled: boolean;
  monitorMode: string;
  alertType: string | null;
  status: string;
  latestSnapshotUrl: string | null;
  lastSnapshotAt: string | null;
}

interface DvrBody {
  id: string;
  url: string;
  username: string;
  cameraCount: number;
  lastTestOk: boolean | null;
}

interface SnapshotBody {
  id: string;
  url: string;
  byteSize: number;
}

interface ErrorBody {
  code: string;
  message: string;
}

describe('DVR, cameras and snapshots (e2e)', () => {
  let ctx: E2eContext;
  let admin: SeededAdmin;
  let token: string;

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
      {
        externalId: 'ch1',
        name: 'Channel 1',
        location: 'Gate',
        status: 'online',
      },
      {
        externalId: 'ch2',
        name: 'Channel 2',
        location: null,
        status: 'offline',
      },
    ];
  });

  function auth(bearer = token) {
    return { Authorization: `Bearer ${bearer}` };
  }

  function configureDvr(bearer = token) {
    return request(ctx.httpServer).put('/api/v1/dvr').set(auth(bearer)).send({
      url: 'http://192.168.1.10:8000',
      username: 'dvr-admin',
      password: 'dvr-password',
      timezone: 'America/Argentina/Buenos_Aires',
    });
  }

  async function listCameras(bearer = token): Promise<CameraBody[]> {
    const res = await request(ctx.httpServer)
      .get('/api/v1/cameras')
      .set(auth(bearer));
    expect(res.status).toBe(200);
    return typedBody<CameraBody[]>(res);
  }

  it('rejects a camera list without a token', async () => {
    const res = await request(ctx.httpServer).get('/api/v1/cameras');
    expect(res.status).toBe(401);
  });

  it('discovers the recorder channels and never answers with its password', async () => {
    const res = await configureDvr();

    expect(res.status).toBe(200);
    const body = typedBody<DvrBody>(res);
    expect(body).toMatchObject({ cameraCount: 2, lastTestOk: true });
    expect(JSON.stringify(body)).not.toContain('dvr-password');

    const cameras = await listCameras();
    expect(cameras.map((camera) => camera.externalId)).toEqual(['ch1', 'ch2']);
    expect(cameras[0]).toMatchObject({
      name: 'Channel 1',
      isConfigured: false,
      latestSnapshotUrl: null,
    });
  });

  it('stores nothing when the recorder cannot be reached', async () => {
    ctx.fakeDvrClient.reachable = false;

    const res = await configureDvr();

    expect(res.status).toBe(502);
    const detail = await request(ctx.httpServer).get('/api/v1/dvr').set(auth());
    expect(detail.status).toBe(404);
  });

  it('keeps the saved configuration on rediscovery and unconfigures a vanished channel', async () => {
    await configureDvr();
    const [first, second] = await listCameras();

    const configured = await request(ctx.httpServer)
      .put(`/api/v1/cameras/${first.id}`)
      .set(auth())
      .send({ name: 'Front door', monitorMode: 'full', alertType: 'intruder' });
    expect(configured.status).toBe(200);
    const configuredSecond = await request(ctx.httpServer)
      .put(`/api/v1/cameras/${second.id}`)
      .set(auth())
      .send({ monitorMode: 'full', alertType: 'suspicious' });
    expect(configuredSecond.status).toBe(200);

    ctx.fakeDvrClient.channels = [
      {
        externalId: 'ch1',
        name: 'Channel 1 renamed upstream',
        status: 'online',
      },
    ];
    const rediscovered = await request(ctx.httpServer)
      .post('/api/v1/dvr/discovery')
      .set(auth());
    expect(rediscovered.status).toBe(200);

    const cameras = await listCameras();
    expect(cameras).toHaveLength(2);
    expect(cameras.find((camera) => camera.externalId === 'ch1')).toMatchObject(
      { name: 'Front door', alertType: 'intruder', isConfigured: true },
    );
    // The channel the recorder stopped reporting keeps its row and its zones,
    // and stops being monitored until it comes back.
    expect(cameras.find((camera) => camera.externalId === 'ch2')).toMatchObject(
      { isConfigured: false },
    );
  });

  it('refuses recorder-owned fields on a camera update', async () => {
    await configureDvr();
    const [camera] = await listCameras();

    const res = await request(ctx.httpServer)
      .put(`/api/v1/cameras/${camera.id}`)
      .set(auth())
      .send({ externalId: 'ch99', status: 'online' });

    expect(res.status).toBe(400);
  });

  it('refuses full-frame monitoring without an alert level', async () => {
    await configureDvr();
    const [camera] = await listCameras();

    const res = await request(ctx.httpServer)
      .put(`/api/v1/cameras/${camera.id}`)
      .set(auth())
      .send({ monitorMode: 'full' });

    expect(res.status).toBe(400);
    expect(typedBody<ErrorBody>(res).code).toBe('VALIDATION_ERROR');
  });

  it("keeps camera configuration out of a plain member's hands", async () => {
    await configureDvr();
    const [camera] = await listCameras();
    await seedMember(ctx.prisma, admin.spaceId, 'member@example.com');
    const memberToken = await loginAs(
      ctx.httpServer,
      'member@example.com',
      E2E_PASSWORD,
    );

    const read = await request(ctx.httpServer)
      .get(`/api/v1/cameras/${camera.id}`)
      .set(auth(memberToken));
    expect(read.status).toBe(200);

    const write = await request(ctx.httpServer)
      .put(`/api/v1/cameras/${camera.id}`)
      .set(auth(memberToken))
      .send({ name: 'Member rename' });
    expect(write.status).toBe(403);
  });

  it('stores a captured frame and serves the bytes only to its own space', async () => {
    await configureDvr();
    const [camera] = await listCameras();

    const captured = await request(ctx.httpServer)
      .post(`/api/v1/cameras/${camera.id}/snapshots`)
      .set(auth());
    expect(captured.status).toBe(201);
    const snapshot = typedBody<SnapshotBody>(captured);
    expect(snapshot.url).toBe(`/api/v1/snapshots/${snapshot.id}`);

    const bytes = await request(ctx.httpServer)
      .get(snapshot.url)
      .set(auth())
      .buffer(true);
    expect(bytes.status).toBe(200);
    expect(bytes.headers['content-type']).toBe('image/jpeg');
    expect(bytes.headers['cache-control']).toBe('private, no-cache');
    expect(bytes.headers['etag']).toBeDefined();

    // Same id, new bytes on every capture: the browser must revalidate instead
    // of answering a refresh from its own cache.
    const revalidated = await request(ctx.httpServer)
      .get(snapshot.url)
      .set(auth())
      .set('If-None-Match', bytes.headers['etag'])
      .buffer(true);
    expect(revalidated.status).toBe(304);

    const listed = await listCameras();
    expect(listed[0].latestSnapshotUrl).toBe(snapshot.url);
    expect(listed[0].lastSnapshotAt).not.toBeNull();
    expect(JSON.stringify(listed)).not.toContain('fake-snapshot-bytes');

    const other = await seedTenant(
      ctx.prisma,
      'other-owner@example.com',
      'Other space',
    );
    const otherToken = await loginAs(
      ctx.httpServer,
      other.email,
      other.password,
    );
    const stolen = await request(ctx.httpServer)
      .get(snapshot.url)
      .set(auth(otherToken));
    expect(stolen.status).toBe(404);
    expect(typedBody<ErrorBody>(stolen).code).toBe('NOT_FOUND');
  });

  it('marks a camera offline when the recorder stops answering', async () => {
    await configureDvr();
    const [camera] = await listCameras();
    ctx.fakeDvrClient.reachable = false;

    const captured = await request(ctx.httpServer)
      .post(`/api/v1/cameras/${camera.id}/snapshots`)
      .set(auth());

    expect(captured.status).toBe(504);
    const [refreshed] = await listCameras();
    expect(refreshed.status).toBe('offline');
  });

  it('hides a deleted camera from reads while its alert history keeps its label', async () => {
    await configureDvr();
    const [camera] = await listCameras();
    await ctx.prisma.alertEvent.create({
      data: {
        spaceId: admin.spaceId,
        cameraId: camera.id,
        cameraLabelSnapshot: 'Channel 1 – Gate',
        alertType: 'intruder',
        detectedAt: new Date(),
      },
    });

    const deleted = await request(ctx.httpServer)
      .delete(`/api/v1/cameras/${camera.id}`)
      .set(auth());
    expect(deleted.status).toBe(200);

    const cameras = await listCameras();
    expect(cameras.map((entry) => entry.id)).not.toContain(camera.id);
    const detail = await request(ctx.httpServer)
      .get(`/api/v1/cameras/${camera.id}`)
      .set(auth());
    expect(detail.status).toBe(404);

    const event = await ctx.prisma.alertEvent.findFirst({
      where: { spaceId: admin.spaceId },
    });
    expect(event).toMatchObject({
      cameraId: camera.id,
      cameraLabelSnapshot: 'Channel 1 – Gate',
      alertType: 'intruder',
    });
  });
});
