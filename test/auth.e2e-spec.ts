import request from 'supertest';
import {
  bootstrapE2eApp,
  E2eContext,
  ensureAdminSeeded,
} from './utils/bootstrap-e2e-app';
import { typedBody } from './utils/typed-body';

interface TokenPairBody {
  accessToken: string;
  refreshToken: string;
}

interface ErrorBody {
  code: string;
}

interface DocsJsonBody {
  info: { title: string };
}

interface HealthReadyBody {
  info: { db: { status: string } };
}

describe('Auth (e2e)', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await bootstrapE2eApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await ensureAdminSeeded(ctx.prisma);
  });

  it('logs in with the seeded admin and returns both tokens', async () => {
    const res = await request(ctx.httpServer).post('/api/v1/auth/login').send({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
    const body = typedBody<TokenPairBody>(res);

    expect(res.status).toBe(200);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
  });

  it('rejects a wrong password with a 401 envelope', async () => {
    const res = await request(ctx.httpServer).post('/api/v1/auth/login').send({
      email: process.env.ADMIN_EMAIL,
      password: 'definitely-wrong',
    });

    expect(res.status).toBe(401);
    expect(typedBody<ErrorBody>(res)).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rotates the token pair on refresh', async () => {
    const login = await request(ctx.httpServer)
      .post('/api/v1/auth/login')
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      });
    const loginBody = typedBody<TokenPairBody>(login);

    const refresh = await request(ctx.httpServer)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginBody.refreshToken });

    expect(refresh.status).toBe(200);
    expect(typedBody<TokenPairBody>(refresh).accessToken).toEqual(
      expect.any(String),
    );
  });

  it('rejects a protected route without a token', async () => {
    const res = await request(ctx.httpServer).get('/api/v1/cameras');

    expect(res.status).toBe(401);
  });

  it('/docs-json loads with the expected title', async () => {
    const res = await request(ctx.httpServer).get('/docs-json');

    expect(res.status).toBe(200);
    expect(typedBody<DocsJsonBody>(res).info.title).toBe('Tu Seguridad API');
  });

  it('/health/live and /health/ready are public', async () => {
    const live = await request(ctx.httpServer).get('/health/live');
    const ready = await request(ctx.httpServer).get('/health/ready');

    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(typedBody<HealthReadyBody>(ready).info.db.status).toBe('up');
  });
});
