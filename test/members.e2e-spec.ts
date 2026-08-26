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

interface MemberBody {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  avatarUrl: string | null;
  isActive: boolean;
  profileCompleted: boolean;
  lastLoginAt: string | null;
  receiveAlerts: boolean;
}

interface MemberListBody {
  items: MemberBody[];
  total: number;
}

interface InvitationListBody {
  items: { id: string; email: string; expiresAt: string; createdAt: string }[];
  total: number;
}

describe('Members (e2e)', () => {
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

  function listMembers(bearer = token) {
    return request(ctx.httpServer)
      .get('/api/v1/members')
      .set(auth(bearer))
      .send();
  }

  it('lists the roster of the caller space, deactivated members included', async () => {
    const member = await seedMember(
      ctx.prisma,
      admin.spaceId,
      'inactive@example.com',
    );
    await ctx.prisma.user.update({
      where: { id: member.userId },
      data: { isActive: false },
    });

    const res = await listMembers();

    expect(res.status).toBe(200);
    const body = typedBody<MemberListBody>(res);
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    const deactivated = body.items.find((row) => row.id === member.userId);
    expect(deactivated).toMatchObject({
      email: 'inactive@example.com',
      firstName: 'Space',
      lastName: 'Member',
      phone: '+10000000002',
      avatarUrl: null,
      isActive: false,
      profileCompleted: true,
      lastLoginAt: null,
    });
    expect(body.items[0]).toMatchObject({
      id: admin.userId,
      email: admin.email,
      isActive: true,
      receiveAlerts: true,
    });
    expect(body.items[0].lastLoginAt).not.toBeNull();
  });

  it('never leaks a member of another space', async () => {
    const other = await seedTenant(
      ctx.prisma,
      'other-owner@example.com',
      'Other Space',
    );

    const res = await listMembers();

    expect(res.status).toBe(200);
    const body = typedBody<MemberListBody>(res);
    expect(body.total).toBe(1);
    expect(body.items.map((row) => row.id)).not.toContain(other.userId);
  });

  it('answers a plain member too — the roster is not admin-only', async () => {
    const member = await seedMember(
      ctx.prisma,
      admin.spaceId,
      'plain@example.com',
    );
    const memberToken = await loginAs(
      ctx.httpServer,
      member.email,
      E2E_PASSWORD,
    );

    const res = await listMembers(memberToken);

    expect(res.status).toBe(200);
    expect(typedBody<MemberListBody>(res).total).toBe(2);
  });

  it('lists pending invitations for an admin, without the token', async () => {
    await request(ctx.httpServer)
      .post('/api/v1/invitations')
      .set(auth())
      .send({ email: 'invited@example.com' })
      .expect(201);

    const res = await request(ctx.httpServer)
      .get('/api/v1/invitations')
      .set(auth())
      .send();

    expect(res.status).toBe(200);
    const body = typedBody<InvitationListBody>(res);
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ email: 'invited@example.com' });
    expect(JSON.stringify(body)).not.toContain('token');
  });

  it('refuses the invitation list to a plain member', async () => {
    const member = await seedMember(
      ctx.prisma,
      admin.spaceId,
      'plain@example.com',
    );
    const memberToken = await loginAs(
      ctx.httpServer,
      member.email,
      E2E_PASSWORD,
    );

    const res = await request(ctx.httpServer)
      .get('/api/v1/invitations')
      .set(auth(memberToken))
      .send();

    expect(res.status).toBe(403);
  });

  describe('PATCH /api/v1/members/:userId', () => {
    function patchMember(
      userId: number | string,
      body: Record<string, unknown>,
      bearer = token,
    ) {
      return request(ctx.httpServer)
        .patch(`/api/v1/members/${userId}`)
        .set(auth(bearer))
        .send(body);
    }

    it("flips a member's alert opt-in and persists it", async () => {
      const member = await seedMember(
        ctx.prisma,
        admin.spaceId,
        'plain@example.com',
      );

      const res = await patchMember(member.userId, { receiveAlerts: false });

      expect(res.status).toBe(200);
      expect(typedBody<MemberBody>(res)).toMatchObject({
        id: member.userId,
        receiveAlerts: false,
      });

      const after = typedBody<MemberListBody>(await listMembers());
      const row = after.items.find((item) => item.id === member.userId);
      expect(row).toMatchObject({ receiveAlerts: false });
    });

    it('refuses a plain member', async () => {
      const member = await seedMember(
        ctx.prisma,
        admin.spaceId,
        'plain@example.com',
      );
      const memberToken = await loginAs(
        ctx.httpServer,
        member.email,
        E2E_PASSWORD,
      );

      const res = await patchMember(
        member.userId,
        { receiveAlerts: false },
        memberToken,
      );

      expect(res.status).toBe(403);
    });

    it('answers 404 for a user id outside the caller space', async () => {
      const other = await seedTenant(
        ctx.prisma,
        'other-owner@example.com',
        'Other Space',
      );

      const res = await patchMember(other.userId, { receiveAlerts: false });

      expect(res.status).toBe(404);
    });

    it('answers 400 for a non-numeric id', async () => {
      const res = await patchMember('not-a-number', { receiveAlerts: false });

      expect(res.status).toBe(400);
    });
  });
});
