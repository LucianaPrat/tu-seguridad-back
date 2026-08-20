import request from 'supertest';
import { authAs, loginAs } from './utils/auth-as';
import {
  bootstrapE2eApp,
  E2eContext,
  ensureAdminSeeded,
  SeededAdmin,
} from './utils/bootstrap-e2e-app';
import { seedMember } from './utils/seed-tenant';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface InvitationBody {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
}

interface AccessTokenBody {
  accessToken: string;
  refreshToken?: string;
}

interface MeBody {
  id: number;
  email: string;
  spaceId: string;
  role: string;
  profileCompleted: boolean;
}

interface ErrorBody {
  code: string;
  message: string;
}

describe('Invitations (e2e)', () => {
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
    ctx.fakeCredentialDelivery.deliveries = [];
  });

  function auth(bearer = token) {
    return { Authorization: `Bearer ${bearer}` };
  }

  function invite(email: string, bearer = token) {
    return request(ctx.httpServer)
      .post('/api/v1/invitations')
      .set(auth(bearer))
      .send({ email });
  }

  function accept(inviteToken: string) {
    return request(ctx.httpServer)
      .post('/api/v1/invitations/accept')
      .send({ token: inviteToken });
  }

  function refreshCookie(res: request.Response): string | undefined {
    const cookies = res.headers['set-cookie'] as unknown as
      string[] | undefined;
    return cookies?.find((entry) => entry.startsWith('refresh_token='));
  }

  it('creates an invitation and delivers the raw token out of band, never in the body', async () => {
    const res = await invite('new-member@example.com');

    expect(res.status).toBe(201);
    const body = typedBody<InvitationBody>(res);
    expect(body).toMatchObject({ email: 'new-member@example.com' });
    expect(Object.keys(body)).not.toContain('token');
    const deliveredToken =
      ctx.fakeCredentialDelivery.lastTokenFor('invitation');
    expect(JSON.stringify(body)).not.toContain(deliveredToken);
  });

  it("keeps inviting out of a plain member's hands", async () => {
    await seedMember(ctx.prisma, admin.spaceId, 'member@example.com');
    const memberToken = await loginAs(
      ctx.httpServer,
      'member@example.com',
      'e2e-password-1234',
    );

    const res = await invite('another@example.com', memberToken);

    expect(res.status).toBe(403);
    expect(typedBody<ErrorBody>(res).code).toBe('FORBIDDEN');
  });

  it('accepts the delivered token, creates one membership in the inviting space and opens a session', async () => {
    await invite('new-member@example.com');
    const inviteToken = ctx.fakeCredentialDelivery.lastTokenFor('invitation');

    const res = await accept(inviteToken);

    expect(res.status).toBe(200);
    const body = typedBody<AccessTokenBody>(res);
    expect(body.accessToken).toEqual(expect.any(String));
    // The refresh token rides the cookie now — leaking it in the body would
    // hand it straight back to any XSS.
    expect(body.refreshToken).toBeUndefined();
    const cookie = refreshCookie(res);
    expect(cookie).toContain('HttpOnly');

    const me = await request(ctx.httpServer)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(me.status).toBe(200);
    const meBody = typedBody<MeBody>(me);
    expect(meBody).toMatchObject({
      email: 'new-member@example.com',
      spaceId: admin.spaceId,
      role: 'member',
      profileCompleted: false,
    });

    const memberships = await ctx.prisma.spaceMember.findMany({
      where: { userId: meBody.id },
    });
    expect(memberships).toHaveLength(1);
  });

  it('gates a freshly accepted invitation to profile completion', async () => {
    await invite('new-member@example.com');
    const inviteToken = ctx.fakeCredentialDelivery.lastTokenFor('invitation');
    const accepted = await accept(inviteToken);
    const { accessToken } = typedBody<AccessTokenBody>(accepted);

    const res = await request(ctx.httpServer)
      .get('/api/v1/cameras')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(typedBody<ErrorBody>(res).code).toBe('FORBIDDEN');
  });

  it('answers 401 on a replayed token — an invitation is single use', async () => {
    await invite('new-member@example.com');
    const inviteToken = ctx.fakeCredentialDelivery.lastTokenFor('invitation');

    const first = await accept(inviteToken);
    const replay = await accept(inviteToken);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(401);
    expect(typedBody<ErrorBody>(replay).code).toBe('UNAUTHORIZED');
  });

  it('answers 401 on an unknown token, revealing nothing about the address', async () => {
    const res = await accept('garbage-token-that-was-never-issued');

    expect(res.status).toBe(401);
    expect(typedBody<ErrorBody>(res).code).toBe('UNAUTHORIZED');
  });

  it('refuses a second pending invitation for the same address in the same space', async () => {
    await invite('twice@example.com');

    const res = await invite('twice@example.com');

    expect(res.status).toBe(409);
    expect(typedBody<ErrorBody>(res).code).toBe('CONFLICT');
  });

  it('refuses to invite an email that already belongs to a space', async () => {
    const res = await invite(admin.email);

    expect(res.status).toBe(409);
    expect(typedBody<ErrorBody>(res).code).toBe('CONFLICT');
  });
});
