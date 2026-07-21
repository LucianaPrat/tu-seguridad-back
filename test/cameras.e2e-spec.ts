import request from 'supertest';
import { bootstrapE2eApp, E2eContext } from './utils/bootstrap-e2e-app';
import { authAs } from './utils/auth-as';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface CameraBody {
  snapshotUrl: string;
}

interface ErrorBody {
  code: string;
  message: string;
}

describe('Cameras (e2e)', () => {
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
  });

  function auth() {
    return { Authorization: `Bearer ${token}` };
  }

  it('rejects a create without a token', async () => {
    const res = await request(ctx.httpServer).post('/api/v1/cameras').send({
      id: 'camera_e2e_01',
      name: 'E2e Cam',
      snapshotUrl: 'http://dvr.local/snap.jpg',
    });

    expect(res.status).toBe(401);
  });

  it('creates, masks on list, shows full url on detail, rejects duplicates', async () => {
    const create = await request(ctx.httpServer)
      .post('/api/v1/cameras')
      .set(auth())
      .send({
        id: 'camera_e2e_01',
        name: 'E2e Cam',
        snapshotUrl: 'http://user:pass@dvr.local/snap.jpg',
      });
    expect(create.status).toBe(201);

    const list = await request(ctx.httpServer)
      .get('/api/v1/cameras')
      .set(auth());
    expect(list.status).toBe(200);
    expect(typedBody<CameraBody[]>(list)[0].snapshotUrl).toBe('***');

    const detail = await request(ctx.httpServer)
      .get('/api/v1/cameras/camera_e2e_01')
      .set(auth());
    expect(typedBody<CameraBody>(detail).snapshotUrl).toBe(
      'http://user:pass@dvr.local/snap.jpg',
    );

    const duplicate = await request(ctx.httpServer)
      .post('/api/v1/cameras')
      .set(auth())
      .send({
        id: 'camera_e2e_01',
        name: 'Dup',
        snapshotUrl: 'http://dvr.local/snap.jpg',
      });
    expect(duplicate.status).toBe(409);
    expect(typedBody<ErrorBody>(duplicate).code).toBe('CONFLICT');
  });

  it('rejects an invalid confidenceThreshold with a VALIDATION_ERROR envelope', async () => {
    const res = await request(ctx.httpServer)
      .post('/api/v1/cameras')
      .set(auth())
      .send({
        id: 'camera_e2e_02',
        name: 'Bad Cam',
        snapshotUrl: 'http://dvr.local/snap.jpg',
        confidenceThreshold: 2,
      });
    const body = typedBody<ErrorBody>(res);

    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toContain('confidenceThreshold');
  });

  it('returns 404 for an unknown camera', async () => {
    const res = await request(ctx.httpServer)
      .get('/api/v1/cameras/camera_missing')
      .set(auth());

    expect(res.status).toBe(404);
    expect(typedBody<ErrorBody>(res).code).toBe('NOT_FOUND');
  });
});
