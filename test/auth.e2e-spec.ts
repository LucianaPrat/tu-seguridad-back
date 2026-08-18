import request from 'supertest';
import {
  bootstrapE2eApp,
  E2eContext,
  ensureAdminSeeded,
} from './utils/bootstrap-e2e-app';
import { typedBody } from './utils/typed-body';

interface AccessTokenBody {
  accessToken: string;
  refreshToken?: string;
}

interface MeBody {
  id: number;
  email: string;
  spaceId: string;
  spaceName: string;
  role: string;
  profileCompleted: boolean;
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

  function login() {
    return request(ctx.httpServer).post('/api/v1/auth/login').send({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
  }

  function refreshCookie(res: request.Response): string {
    const cookies = res.headers['set-cookie'] as unknown as
      string[] | undefined;
    const cookie = cookies?.find((entry) => entry.startsWith('refresh_token='));
    if (!cookie) {
      throw new Error('no refresh_token cookie on the response');
    }
    return cookie;
  }

  it('logs in with the seeded admin and returns only the access token', async () => {
    const res = await login();
    const body = typedBody<AccessTokenBody>(res);

    expect(res.status).toBe(200);
    expect(body.accessToken).toEqual(expect.any(String));
    // The refresh token rides the cookie now — leaking it in the body would
    // hand it straight back to any XSS.
    expect(body.refreshToken).toBeUndefined();
  });

  it('ships the refresh token as an HttpOnly, path-scoped cookie', async () => {
    const cookie = refreshCookie(await login());

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rejects a wrong password with a 401 envelope', async () => {
    const res = await request(ctx.httpServer).post('/api/v1/auth/login').send({
      email: process.env.ADMIN_EMAIL,
      password: 'definitely-wrong',
    });

    expect(res.status).toBe(401);
    expect(typedBody<ErrorBody>(res)).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rotates the token pair on refresh, driven by the cookie', async () => {
    const cookie = refreshCookie(await login());

    const refresh = await request(ctx.httpServer)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie);

    expect(refresh.status).toBe(200);
    expect(typedBody<AccessTokenBody>(refresh).accessToken).toEqual(
      expect.any(String),
    );
    expect(refreshCookie(refresh)).toContain('HttpOnly');
  });

  it('rejects a refresh with no cookie', async () => {
    const res = await request(ctx.httpServer).post('/api/v1/auth/refresh');

    expect(res.status).toBe(401);
    expect(typedBody<ErrorBody>(res)).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('returns the current user with its space context on /auth/me', async () => {
    const { accessToken } = typedBody<AccessTokenBody>(await login());

    const res = await request(ctx.httpServer)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(typedBody<MeBody>(res)).toMatchObject({
      id: expect.any(Number) as number,
      email: process.env.ADMIN_EMAIL?.toLowerCase(),
      spaceId: expect.any(String) as string,
      spaceName: expect.any(String) as string,
      role: 'admin',
      profileCompleted: true,
    });
  });

  it('never returns the password hash on /auth/me', async () => {
    const { accessToken } = typedBody<AccessTokenBody>(await login());

    const res = await request(ctx.httpServer)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(Object.keys(typedBody<MeBody>(res))).not.toContain('passwordHash');
  });

  it('rejects a replayed refresh cookie after it has been rotated', async () => {
    const cookie = refreshCookie(await login());

    const first = await request(ctx.httpServer)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie);
    const replay = await request(ctx.httpServer)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(401);
  });

  it('revokes the stored refresh token on logout', async () => {
    const cookie = refreshCookie(await login());

    await request(ctx.httpServer)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie);
    const afterLogout = await request(ctx.httpServer)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie);

    expect(afterLogout.status).toBe(401);
  });

  it('rejects /auth/me without a token', async () => {
    const res = await request(ctx.httpServer).get('/api/v1/auth/me');

    expect(res.status).toBe(401);
  });

  it('clears the refresh cookie on logout', async () => {
    const res = await request(ctx.httpServer).post('/api/v1/auth/logout');

    expect(res.status).toBe(204);
    expect(refreshCookie(res)).toMatch(/refresh_token=;/);
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
