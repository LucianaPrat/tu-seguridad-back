import request from 'supertest';
import { authAs, loginAs } from './utils/auth-as';
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

interface InvitationBody {
  id: string;
  email: string;
  role: string;
  menuAccess: string[];
  cameraIds: string[];
}

interface MineBody {
  id: string;
  spaceId: string;
  spaceName: string;
  invitedByName: string;
  role: string;
}

interface PreviewBody {
  id: string;
  spaceName: string;
  email: string;
  role: string;
  userExists: boolean;
}

interface AccessTokenBody {
  accessToken: string;
  refreshToken?: string;
}

interface MeBody {
  currentSpace: {
    id: string;
    role: string;
    menuAccess: string[];
    cameraIds: string[];
  } | null;
  spaces: { id: string }[];
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

  const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });

  function invite(
    body: { email: string; role?: string; cameraIds?: string[] },
    as = token,
  ) {
    return request(ctx.httpServer)
      .post('/api/v1/invitations')
      .set(bearer(as))
      .send({ role: 'collaborator', ...body });
  }

  const lastToken = () => ctx.fakeCredentialDelivery.lastTokenFor('invitation');

  const preview = (inviteToken: string) =>
    request(ctx.httpServer).get('/api/v1/invitations/preview').query({
      token: inviteToken,
    });

  const mine = (as: string) =>
    request(ctx.httpServer).get('/api/v1/invitations/mine').set(bearer(as));

  const act = (as: string, id: string, action: 'accept' | 'decline') =>
    request(ctx.httpServer)
      .post(`/api/v1/invitations/${id}/${action}`)
      .set(bearer(as));

  const meOf = async (as: string) =>
    typedBody<MeBody>(
      await request(ctx.httpServer).get('/api/v1/auth/me').set(bearer(as)),
    );

  const register = (email: string, inviteToken: string) =>
    request(ctx.httpServer).post('/api/v1/auth/register').send({
      email,
      password: E2E_PASSWORD,
      firstName: 'Grace',
      lastName: 'Hopper',
      phone: '+5491122334455',
      inviteToken,
    });

  async function seedCamera(): Promise<string> {
    const dvr = await ctx.prisma.dvr.create({
      data: {
        spaceId: admin.spaceId,
        url: 'http://192.168.1.10:8000',
        username: 'u',
        passwordEncrypted: 'x',
        timezone: 'UTC',
      },
    });
    const camera = await ctx.prisma.camera.create({
      data: { dvrId: dvr.id, externalId: '1', name: 'Door' },
    });
    return camera.id;
  }

  it('mails the raw token, never returning it in the body', async () => {
    const res = await invite({ email: 'new@example.com' });

    expect(res.status).toBe(201);
    const body = typedBody<InvitationBody>(res);
    expect(body).toMatchObject({
      email: 'new@example.com',
      role: 'collaborator',
      cameraIds: [],
    });
    expect(body.menuAccess).toEqual(
      expect.arrayContaining(['home', 'monitor', 'events']),
    );
    expect(JSON.stringify(body)).not.toContain(lastToken());
    expect(ctx.fakeCredentialDelivery.deliveries[0].invitation).toMatchObject({
      spaceName: admin.spaceName,
      role: 'collaborator',
    });
  });

  it('invites a user who owns another space, who then accepts into the inviter space', async () => {
    const other = await seedTenant(ctx.prisma, 'owner@example.com', 'Theirs');
    const otherToken = await loginAs(ctx.httpServer, other.email, E2E_PASSWORD);

    const created = await invite({ email: other.email, role: 'guest' });
    expect(created.status).toBe(201);

    const inbox = await mine(otherToken);
    expect(inbox.status).toBe(200);
    const [entry] = typedBody<MineBody[]>(inbox);
    expect(entry).toMatchObject({
      spaceId: admin.spaceId,
      spaceName: admin.spaceName,
      role: 'guest',
    });

    const accepted = await act(otherToken, entry.id, 'accept');
    expect(accepted.status).toBe(200);
    expect(typedBody<AccessTokenBody>(accepted).refreshToken).toBeUndefined();
    expect(refreshCookie(accepted)).toContain('HttpOnly');

    const me = await meOf(typedBody<AccessTokenBody>(accepted).accessToken);
    expect(me.currentSpace).toMatchObject({
      id: admin.spaceId,
      role: 'guest',
    });
    expect(me.spaces).toHaveLength(2);
    expect((await mine(otherToken)).body).toEqual([]);
  });

  it('registers with an inviteToken into no space, then accept creates the membership from the invitation', async () => {
    const cameraId = await seedCamera();
    await invite({
      email: 'Fresh@Example.com',
      role: 'guest',
      cameraIds: [cameraId],
    });

    const registered = await register('fresh@example.com', lastToken());
    expect(registered.status).toBe(201);
    const session = typedBody<AccessTokenBody>(registered).accessToken;
    const before = await meOf(session);
    expect(before.currentSpace).toBeNull();
    expect(before.spaces).toHaveLength(0);

    const [entry] = typedBody<MineBody[]>(await mine(session));
    const accepted = await act(session, entry.id, 'accept');
    expect(accepted.status).toBe(200);

    const after = await meOf(typedBody<AccessTokenBody>(accepted).accessToken);
    expect(after.spaces).toHaveLength(1);
    expect(after.currentSpace).toMatchObject({
      id: admin.spaceId,
      role: 'guest',
      menuAccess: ['home', 'monitor'],
      cameraIds: [cameraId],
    });
  });

  it('previews a pending invitation by token', async () => {
    await invite({ email: 'new@example.com', role: 'admin' });

    const res = await preview(lastToken());

    expect(res.status).toBe(200);
    expect(typedBody<PreviewBody>(res)).toMatchObject({
      spaceName: admin.spaceName,
      email: 'new@example.com',
      role: 'admin',
      userExists: false,
    });
  });

  it('refuses to accept while signed in as a different address', async () => {
    const created = await invite({ email: 'invitee@example.com' });
    const id = typedBody<InvitationBody>(created).id;
    const other = await seedTenant(ctx.prisma, 'stranger@example.com', 'Other');
    const otherToken = await loginAs(ctx.httpServer, other.email, E2E_PASSWORD);

    const res = await act(otherToken, id, 'accept');

    expect(res.status).toBe(403);
    expect(typedBody<ErrorBody>(res).code).toBe('FORBIDDEN');
  });

  it.each(['declined', 'revoked', 'expired'] as const)(
    'cannot be accepted once %s, and is no longer previewable',
    async (state) => {
      const invitee = await seedTenant(
        ctx.prisma,
        'invitee@example.com',
        'Own',
      );
      const inviteeToken = await loginAs(
        ctx.httpServer,
        invitee.email,
        E2E_PASSWORD,
      );
      const created = await invite({ email: invitee.email });
      const id = typedBody<InvitationBody>(created).id;
      const inviteToken = lastToken();

      if (state === 'declined') {
        const res = await act(inviteeToken, id, 'decline');
        expect(res.status).toBe(204);
      } else if (state === 'revoked') {
        const res = await request(ctx.httpServer)
          .delete(`/api/v1/invitations/${id}`)
          .set(bearer(token));
        expect(res.status).toBe(204);
      } else {
        await ctx.prisma.invitation.update({
          where: { id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      }

      const accepted = await act(inviteeToken, id, 'accept');
      expect(accepted.status).toBe(409);
      expect(typedBody<ErrorBody>(accepted).code).toBe('CONFLICT');
      const previewed = await preview(inviteToken);
      expect(previewed.status).toBe(404);
      expect(typedBody<ErrorBody>(previewed).code).toBe('NOT_FOUND');
    },
  );

  it('resend invalidates the old token and the new one works', async () => {
    const created = await invite({ email: 'new@example.com' });
    const id = typedBody<InvitationBody>(created).id;
    const oldToken = lastToken();

    const res = await request(ctx.httpServer)
      .post(`/api/v1/invitations/${id}/resend`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    const newToken = lastToken();
    expect(newToken).not.toBe(oldToken);
    expect((await preview(oldToken)).status).toBe(404);
    expect((await preview(newToken)).status).toBe(200);
  });

  it("keeps inviting out of a plain member's hands", async () => {
    await seedMember(ctx.prisma, admin.spaceId, 'member@example.com');
    const memberToken = await loginAs(
      ctx.httpServer,
      'member@example.com',
      E2E_PASSWORD,
    );

    const res = await invite({ email: 'another@example.com' }, memberToken);

    expect(res.status).toBe(403);
  });

  it('refuses a duplicate pending invitation and an existing member', async () => {
    await invite({ email: 'twice@example.com' });
    const duplicate = await invite({ email: 'twice@example.com' });
    const member = await invite({ email: admin.email });

    expect(duplicate.status).toBe(409);
    expect(typedBody<ErrorBody>(duplicate).code).toBe('CONFLICT');
    expect(member.status).toBe(409);
  });

  it('rejects cameras that are not in the space', async () => {
    const res = await invite({
      email: 'new@example.com',
      cameraIds: ['11111111-1111-4111-8111-111111111111'],
    });

    expect(res.status).toBe(400);
    expect(typedBody<ErrorBody>(res).code).toBe('VALIDATION_ERROR');
  });

  it('refuses to register with an inviteToken for a different email', async () => {
    await invite({ email: 'invited@example.com' });

    const res = await register('someone-else@example.com', lastToken());

    expect(res.status).toBe(403);
    expect(typedBody<ErrorBody>(res).code).toBe('FORBIDDEN');
    expect(
      await ctx.prisma.user.findUnique({
        where: { email: 'someone-else@example.com' },
      }),
    ).toBeNull();
  });
});
