import request from 'supertest';
import { authAs } from './utils/auth-as';
import {
  bootstrapE2eApp,
  E2eContext,
  ensureAdminSeeded,
} from './utils/bootstrap-e2e-app';
import { TINY_JPEG } from './utils/tiny-jpeg';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface CameraBody {
  id: string;
  externalId: string;
}

interface ZoneBody {
  id: string;
}

interface AnalyzeBody {
  persons: unknown[];
  zoneResults: {
    zoneId: string | null;
    alertType: string;
    occupied: boolean;
  }[];
  alerts: {
    zoneId: string | null;
    alertType: string;
    snapshotId: string | null;
    cameraLabel: string;
  }[];
}

interface ErrorBody {
  code: string;
}

/** Anchor in the middle of the frame; the detector reports [0,1] coordinates. */
const CENTER = { x: 0.5, y: 0.5 };

describe('Analyze pipeline (e2e)', () => {
  let ctx: E2eContext;
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
    await ensureAdminSeeded(ctx.prisma);
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
  });

  function auth() {
    return { Authorization: `Bearer ${token}` };
  }

  function analyze() {
    return request(ctx.httpServer)
      .post(`/api/v1/cameras/${camera.id}/analyze`)
      .set(auth())
      .attach('file', TINY_JPEG, 'frame.jpg');
  }

  function configureCamera(body: Record<string, unknown>) {
    return request(ctx.httpServer)
      .put(`/api/v1/cameras/${camera.id}`)
      .set(auth())
      .send(body);
  }

  it('refuses to process a camera with no monitor configuration', async () => {
    const res = await analyze();

    expect(res.status).toBe(409);
    expect(typedBody<ErrorBody>(res).code).toBe('CONFLICT');
  });

  it('refuses to process a disabled camera', async () => {
    await configureCamera({ monitorMode: 'full', alertType: 'intruder' });
    await configureCamera({ isEnabled: false });

    const res = await analyze();

    expect(res.status).toBe(409);
  });

  it('raises the camera alert level in full mode once hysteresis is satisfied', async () => {
    await configureCamera({ monitorMode: 'full', alertType: 'suspicious' });

    const first = typedBody<AnalyzeBody>(await analyze());
    expect(first.alerts).toHaveLength(0);
    expect(first.zoneResults).toEqual([
      { zoneId: null, alertType: 'suspicious', occupied: true },
    ]);

    const second = typedBody<AnalyzeBody>(await analyze());
    expect(second.alerts).toHaveLength(1);
    expect(second.alerts[0]).toMatchObject({
      zoneId: null,
      alertType: 'suspicious',
      cameraLabel: 'Channel 1 – Gate',
    });

    // The frame that raised the alert is the one stored, and it is reachable
    // only through the authenticated snapshot route.
    const snapshotId = second.alerts[0].snapshotId;
    expect(snapshotId).toEqual(expect.any(String));
    const bytes = await request(ctx.httpServer)
      .get(`/api/v1/snapshots/${snapshotId}`)
      .set(auth());
    expect(bytes.status).toBe(200);
  });

  it('raises the zone alert level in partial mode', async () => {
    await configureCamera({ monitorMode: 'partial' });
    const zone = await request(ctx.httpServer)
      .post(`/api/v1/cameras/${camera.id}/zones`)
      .set(auth())
      .send({ x: 40, y: 40, width: 20, height: 20, alertType: 'intruder' });
    expect(zone.status).toBe(201);
    const outside = await request(ctx.httpServer)
      .post(`/api/v1/cameras/${camera.id}/zones`)
      .set(auth())
      .send({ x: 0, y: 0, width: 10, height: 10, alertType: 'suspicious' });
    expect(outside.status).toBe(201);

    await analyze();
    const second = typedBody<AnalyzeBody>(await analyze());

    expect(second.alerts).toHaveLength(1);
    expect(second.alerts[0]).toMatchObject({
      zoneId: typedBody<ZoneBody>(zone).id,
      alertType: 'intruder',
    });
  });

  it('stores no frame when nothing is detected', async () => {
    await configureCamera({ monitorMode: 'full', alertType: 'intruder' });
    ctx.fakeFaceAuthClient.response = {
      personsDetected: false,
      imageWidth: 1920,
      imageHeight: 1080,
      persons: [],
    };

    await analyze();
    const second = typedBody<AnalyzeBody>(await analyze());

    expect(second.alerts).toHaveLength(0);
    expect(await ctx.prisma.snapshot.count()).toBe(0);
  });

  it('rejects a non-image upload', async () => {
    await configureCamera({ monitorMode: 'full', alertType: 'intruder' });

    const res = await request(ctx.httpServer)
      .post(`/api/v1/cameras/${camera.id}/analyze`)
      .set(auth())
      .attach('file', Buffer.from('not an image'), 'payload.txt');

    expect(res.status).toBe(400);
  });
});
