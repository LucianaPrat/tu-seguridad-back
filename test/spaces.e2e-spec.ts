import { SpaceMemberRole } from '@prisma/client';
import request from 'supertest';
import { loginAs } from './utils/auth-as';
import {
  bootstrapE2eApp,
  E2eContext,
  ensureAdminSeeded,
} from './utils/bootstrap-e2e-app';
import { refreshCookie } from './utils/refresh-cookie';
import { E2E_PASSWORD, seedMember, seedTenant } from './utils/seed-tenant';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface AccessTokenBody {
  accessToken: string;
}

interface SpaceBody {
  id: string;
  name: string;
  role: SpaceMemberRole;
}

interface MeBody {
  currentSpace: (SpaceBody & { menuAccess: string[] }) | null;
  spaces: SpaceBody[];
  pendingInvitationsCount: number;
}

describe('Spaces (e2e)', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await bootstrapE2eApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    await ensureAdminSeeded(ctx.prisma);
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  const me = async (token: string) =>
    typedBody<MeBody>(
      await request(ctx.httpServer).get('/api/v1/auth/me').set(bearer(token)),
    );

  const createSpace = (token: string, name: string) =>
    request(ctx.httpServer)
      .post('/api/v1/spaces')
      .set(bearer(token))
      .send({ name });

  const tokenOf = (res: request.Response) =>
    typedBody<AccessTokenBody>(res).accessToken;

  // A DVR row is enough for the delete guard; it needs no recorder behind it.
  const seedDvr = (spaceId: string) =>
    ctx.prisma.dvr.create({
      data: {
        spaceId,
        url: 'http://192.168.1.10:8000',
        username: 'u',
        passwordEncrypted: 'x',
        timezone: 'UTC',
      },
    });

  it('creates a second space, moves the session into it and scopes /cameras', async () => {
    const owner = await seedTenant(ctx.prisma, 'owner@example.com', 'First');
    const login = await loginAs(ctx.httpServer, owner.email, E2E_PASSWORD);

    const created = await createSpace(login, '  Second  ');
    expect(created.status).toBe(201);
    refreshCookie(created);
    const token = tokenOf(created);

    const body = await me(token);
    expect(body.currentSpace).toMatchObject({ name: 'Second', role: 'admin' });
    expect(body.currentSpace?.id).not.toBe(owner.spaceId);
    expect(body.spaces).toHaveLength(2);

    const cameras = await request(ctx.httpServer)
      .get('/api/v1/cameras')
      .set(bearer(token));
    expect(cameras.status).toBe(200);
    expect(typedBody<unknown[]>(cameras)).toEqual([]);
  });

  it('switches back, and a refresh keeps the chosen space', async () => {
    const owner = await seedTenant(ctx.prisma, 'owner@example.com', 'First');
    const created = await createSpace(
      await loginAs(ctx.httpServer, owner.email, E2E_PASSWORD),
      'Second',
    );

    const switched = await request(ctx.httpServer)
      .post('/api/v1/auth/switch-space')
      .set(bearer(tokenOf(created)))
      .set('Cookie', refreshCookie(created))
      .send({ spaceId: owner.spaceId });
    expect(switched.status).toBe(200);
    expect((await me(tokenOf(switched))).currentSpace?.id).toBe(owner.spaceId);

    // The refresh token presented to the switch is revoked.
    const replay = await request(ctx.httpServer)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(created));
    expect(replay.status).toBe(401);

    // Replaying revoked the whole family; log in again to test the new cookie.
    const relogin = await loginAs(ctx.httpServer, owner.email, E2E_PASSWORD);
    expect((await me(relogin)).currentSpace?.id).toBe(owner.spaceId);
  });

  it('refresh after a switch stays in the switched space', async () => {
    const owner = await seedTenant(ctx.prisma, 'owner@example.com', 'First');
    const created = await createSpace(
      await loginAs(ctx.httpServer, owner.email, E2E_PASSWORD),
      'Second',
    );
    const switched = await request(ctx.httpServer)
      .post('/api/v1/auth/switch-space')
      .set(bearer(tokenOf(created)))
      .send({ spaceId: owner.spaceId });

    const refreshed = await request(ctx.httpServer)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(switched));
    expect(refreshed.status).toBe(200);
    expect((await me(tokenOf(refreshed))).currentSpace?.id).toBe(owner.spaceId);
  });

  it('rejects switching to a space the user is not in', async () => {
    const owner = await seedTenant(ctx.prisma, 'owner@example.com', 'First');
    const other = await seedTenant(ctx.prisma, 'other@example.com', 'Other');
    const token = await loginAs(ctx.httpServer, owner.email, E2E_PASSWORD);

    const res = await request(ctx.httpServer)
      .post('/api/v1/auth/switch-space')
      .set(bearer(token))
      .send({ spaceId: other.spaceId });

    expect(res.status).toBe(403);
  });

  it('lets only an admin rename the current space', async () => {
    const owner = await seedTenant(ctx.prisma, 'owner@example.com', 'First');
    const member = await seedMember(ctx.prisma, owner.spaceId, 'c@example.com');

    const denied = await request(ctx.httpServer)
      .patch('/api/v1/spaces/current')
      .set(bearer(await loginAs(ctx.httpServer, member.email, E2E_PASSWORD)))
      .send({ name: 'Nope' });
    expect(denied.status).toBe(403);

    const renamed = await request(ctx.httpServer)
      .patch('/api/v1/spaces/current')
      .set(bearer(await loginAs(ctx.httpServer, owner.email, E2E_PASSWORD)))
      .send({ name: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(typedBody<SpaceBody>(renamed)).toMatchObject({
      id: owner.spaceId,
      name: 'Renamed',
      role: 'admin',
    });
  });

  it('refuses to delete a space with a DVR, and deletes one without', async () => {
    const owner = await seedTenant(ctx.prisma, 'owner@example.com', 'First');
    const login = await loginAs(ctx.httpServer, owner.email, E2E_PASSWORD);
    const second = tokenOf(await createSpace(login, 'Second'));
    const secondId = (await me(second)).currentSpace!.id;
    await seedDvr(secondId);

    const blocked = await request(ctx.httpServer)
      .delete('/api/v1/spaces/current')
      .set(bearer(second));
    expect(blocked.status).toBe(409);

    await ctx.prisma.dvr.delete({ where: { spaceId: secondId } });
    const deleted = await request(ctx.httpServer)
      .delete('/api/v1/spaces/current')
      .set(bearer(second));
    expect(deleted.status).toBe(200);
    const after = await me(tokenOf(deleted));
    expect(after.currentSpace?.id).toBe(owner.spaceId);
    expect(after.spaces).toHaveLength(1);
  });

  it('leaves currentSpace null after deleting the only space, and can create again', async () => {
    const owner = await seedTenant(ctx.prisma, 'owner@example.com', 'First');
    const login = await loginAs(ctx.httpServer, owner.email, E2E_PASSWORD);

    const deleted = await request(ctx.httpServer)
      .delete('/api/v1/spaces/current')
      .set(bearer(login));
    expect(deleted.status).toBe(200);
    const empty = tokenOf(deleted);
    const body = await me(empty);
    expect(body.currentSpace).toBeNull();
    expect(body.spaces).toEqual([]);

    const created = await createSpace(empty, 'Fresh');
    expect(created.status).toBe(201);
    const cameras = await request(ctx.httpServer)
      .get('/api/v1/cameras')
      .set(bearer(tokenOf(created)));
    expect(cameras.status).toBe(200);
  });

  it('counts pending invitations addressed to the user email', async () => {
    const owner = await seedTenant(ctx.prisma, 'owner@example.com', 'First');
    const inviter = await seedTenant(ctx.prisma, 'inviter@example.com', 'Inv');
    const future = new Date(Date.now() + 86_400_000);
    await ctx.prisma.invitation.createMany({
      data: [
        {
          spaceId: inviter.spaceId,
          email: owner.email,
          tokenHash: 'pending-hash',
          invitedByUserId: inviter.userId,
          expiresAt: future,
        },
        {
          spaceId: inviter.spaceId,
          email: owner.email,
          tokenHash: 'revoked-hash',
          invitedByUserId: inviter.userId,
          expiresAt: future,
          revokedAt: new Date(),
        },
      ],
    });

    const token = await loginAs(ctx.httpServer, owner.email, E2E_PASSWORD);

    expect((await me(token)).pendingInvitationsCount).toBe(1);
  });
});
