import { SpaceMemberRole } from '@prisma/client';
import request from 'supertest';
import { DEFAULT_MENU_ACCESS } from '../src/cross/common/permissions';
import { loginAs } from './utils/auth-as';
import {
  bootstrapE2eApp,
  E2eContext,
  ensureAdminSeeded,
  SeededAdmin,
} from './utils/bootstrap-e2e-app';
import { refreshCookie } from './utils/refresh-cookie';
import { E2E_PASSWORD, seedMember, seedTenant } from './utils/seed-tenant';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface AccessTokenBody {
  accessToken: string;
}

interface MeBody {
  spaceId: string | null;
  spaceName: string | null;
  role: SpaceMemberRole | null;
}

describe('Per-request membership (e2e)', () => {
  let ctx: E2eContext;
  let admin: SeededAdmin;

  beforeAll(async () => {
    ctx = await bootstrapE2eApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    admin = await ensureAdminSeeded(ctx.prisma);
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  // An admin-only route that needs no fixtures to answer 200.
  const putRoutings = (token: string) =>
    request(ctx.httpServer)
      .put('/api/v1/alert-routings')
      .set(bearer(token))
      .send({
        items: [{ alertType: 'intruder', channel: 'call', enabled: true }],
      });

  const me = (token: string) =>
    request(ctx.httpServer).get('/api/v1/auth/me').set(bearer(token));

  it('honours a role change on the next request, without a new login', async () => {
    const member = await seedMember(
      ctx.prisma,
      admin.spaceId,
      'promoted@example.com',
    );
    const token = await loginAs(ctx.httpServer, member.email, E2E_PASSWORD);
    expect((await putRoutings(token)).status).toBe(403);

    await ctx.prisma.spaceMember.update({
      where: {
        spaceId_userId: { spaceId: admin.spaceId, userId: member.userId },
      },
      data: { role: 'admin', menuAccess: DEFAULT_MENU_ACCESS.admin },
    });

    expect((await putRoutings(token)).status).toBe(200);
    expect(typedBody<MeBody>(await me(token)).role).toBe('admin');

    await ctx.prisma.spaceMember.update({
      where: {
        spaceId_userId: { spaceId: admin.spaceId, userId: member.userId },
      },
      data: { role: 'collaborator' },
    });

    expect((await putRoutings(token)).status).toBe(403);
  });

  it('answers 403 once the membership behind the token is deleted', async () => {
    const member = await seedMember(
      ctx.prisma,
      admin.spaceId,
      'removed@example.com',
    );
    const token = await loginAs(ctx.httpServer, member.email, E2E_PASSWORD);
    const cameras = () =>
      request(ctx.httpServer).get('/api/v1/cameras').set(bearer(token));
    expect((await cameras()).status).toBe(200);

    await ctx.prisma.spaceMember.delete({
      where: {
        spaceId_userId: { spaceId: admin.spaceId, userId: member.userId },
      },
    });

    const res = await cameras();
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      message: 'You are no longer a member of this space',
    });
  });

  describe('an account with no membership', () => {
    let token: string;

    beforeEach(async () => {
      const member = await seedMember(
        ctx.prisma,
        admin.spaceId,
        'orphan@example.com',
      );
      await ctx.prisma.spaceMember.delete({
        where: {
          spaceId_userId: { spaceId: admin.spaceId, userId: member.userId },
        },
      });
      token = await loginAs(ctx.httpServer, member.email, E2E_PASSWORD);
    });

    it('logs in and reads /auth/me with a null space', async () => {
      const res = await me(token);

      expect(res.status).toBe(200);
      expect(typedBody<MeBody>(res)).toMatchObject({
        spaceId: null,
        spaceName: null,
        role: null,
      });
    });

    it('is refused on a space route', async () => {
      const res = await request(ctx.httpServer)
        .get('/api/v1/cameras')
        .set(bearer(token));

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        message: 'Select or create a space first',
      });
    });
  });

  it('keeps the current space on refresh when the user has two memberships', async () => {
    // A user of its own, not the shared admin: other suites reuse the admin row
    // without truncating, and a second membership left on it would leak.
    const owner = await seedTenant(ctx.prisma, 'owner@example.com', 'Owner');
    const other = await seedTenant(ctx.prisma, 'other@example.com', 'Other');
    // The owner now belongs to a second space it joined more recently.
    await ctx.prisma.spaceMember.create({
      data: {
        spaceId: other.spaceId,
        userId: owner.userId,
        role: 'collaborator',
        menuAccess: DEFAULT_MENU_ACCESS.collaborator,
        cameraIds: [],
      },
    });
    // Login lands in the user's remembered space.
    await ctx.prisma.user.update({
      where: { id: owner.userId },
      data: { lastSpaceId: owner.spaceId },
    });
    const login = await request(ctx.httpServer)
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: owner.password });
    expect(login.status).toBe(200);
    const loggedIn = await me(typedBody<AccessTokenBody>(login).accessToken);
    expect(typedBody<MeBody>(loggedIn).spaceId).toBe(owner.spaceId);

    // Make the other space the most recent and the remembered one; a refresh
    // that re-resolved from the database would jump there.
    await ctx.prisma.user.update({
      where: { id: owner.userId },
      data: { lastSpaceId: other.spaceId },
    });

    const refresh = await request(ctx.httpServer)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(login));

    expect(refresh.status).toBe(200);
    const refreshed = await me(typedBody<AccessTokenBody>(refresh).accessToken);
    expect(typedBody<MeBody>(refreshed).spaceId).toBe(owner.spaceId);
  });
});
