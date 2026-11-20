import request from 'supertest';
import { DEFAULT_MENU_ACCESS } from '../src/cross/common/permissions';
import { loginAs } from './utils/auth-as';
import { bootstrapE2eApp, E2eContext } from './utils/bootstrap-e2e-app';
import {
  E2E_PASSWORD,
  seedDvrWithCameras,
  seedMember,
  seedTenant,
} from './utils/seed-tenant';
import { TINY_JPEG } from './utils/tiny-jpeg';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface MemberBody {
  id: number;
  role: string;
  menuAccess?: string[];
  cameraIds?: string[];
}

interface MemberListBody {
  items: MemberBody[];
}

interface ErrorBody {
  code: string;
  message: string;
}

interface IdBody {
  id: string;
}

interface EventListBody {
  items: { id: string; cameraId: string | null }[];
}

describe('Member management and scoping (e2e)', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await bootstrapE2eApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  // Each test builds its own world; the shared admin is never touched.
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) =>
    request(ctx.httpServer).get(`/api/v1${path}`).set(auth(token));
  const patchMember = (
    token: string,
    userId: number,
    body: Record<string, unknown>,
  ) =>
    request(ctx.httpServer)
      .patch(`/api/v1/members/${userId}`)
      .set(auth(token))
      .send(body);

  async function world() {
    const owner = await seedTenant(ctx.prisma, 'owner@example.com', 'Main');
    const [cam1, cam2] = await seedDvrWithCameras(ctx.prisma, owner.spaceId, 2);
    const ownerToken = await loginAs(ctx.httpServer, owner.email, E2E_PASSWORD);
    return { owner, cam1, cam2, ownerToken };
  }

  async function login(email: string): Promise<string> {
    return loginAs(ctx.httpServer, email, E2E_PASSWORD);
  }

  describe('guest', () => {
    it('sees only its cameras and is refused the others', async () => {
      const { owner, cam1, cam2 } = await world();
      const guest = await seedMember(ctx.prisma, owner.spaceId, 'g@e.com', {
        role: 'guest',
        cameraIds: [cam1],
      });
      const token = await login(guest.email);

      const list = await get(token, '/cameras');
      expect(list.status).toBe(200);
      expect(typedBody<IdBody[]>(list).map((c) => c.id)).toEqual([cam1]);

      expect((await get(token, `/cameras/${cam2}`)).status).toBe(403);
      const live = await get(token, `/cameras/${cam2}/live`);
      expect(live.status).toBe(403);
      expect(typedBody<ErrorBody>(live).message).toBe(
        'You do not have access to this camera',
      );
    });

    it('reads snapshot bytes only of its own cameras', async () => {
      const { owner, cam1, cam2 } = await world();
      const guest = await seedMember(ctx.prisma, owner.spaceId, 'g@e.com', {
        role: 'guest',
        cameraIds: [cam1],
      });
      const token = await login(guest.email);
      const snap = (cameraId: string) =>
        ctx.prisma.snapshot.create({
          data: {
            cameraId,
            data: TINY_JPEG,
            mimeType: 'image/jpeg',
            byteSize: TINY_JPEG.length,
            sha256: 'x',
            capturedAt: new Date(),
          },
        });

      const foreign = await snap(cam2);
      const own = await snap(cam1);

      expect((await get(token, `/snapshots/${foreign.id}`)).status).toBe(403);
      expect((await get(token, `/snapshots/${own.id}`)).status).toBe(200);
    });

    it('is authorized by the media hook only on its own cameras', async () => {
      const { owner, cam1, cam2 } = await world();
      const guest = await seedMember(ctx.prisma, owner.spaceId, 'g@e.com', {
        role: 'guest',
        cameraIds: [cam1],
      });
      const token = await login(guest.email);
      const authorize = (path: string) =>
        request(ctx.httpServer)
          .post('/api/v1/streaming/authorize')
          .send({ action: 'read', protocol: 'hls', path, token });

      expect((await authorize(cam2)).status).toBe(403);
      const own = await authorize(cam1);
      expect(own.status).toBe(200);
      expect(typedBody<{ authorized: boolean }>(own).authorized).toBe(true);
    });

    it('cannot write: dvr, camera, zones', async () => {
      const { owner, cam1 } = await world();
      const guest = await seedMember(ctx.prisma, owner.spaceId, 'g@e.com', {
        role: 'guest',
        cameraIds: [cam1],
      });
      const token = await login(guest.email);

      const dvr = await request(ctx.httpServer)
        .put('/api/v1/dvr')
        .set(auth(token))
        .send({
          url: 'http://192.168.1.10:8000',
          username: 'u',
          password: 'p',
          timezone: 'UTC',
        });
      expect(dvr.status).toBe(403);
      const cam = await request(ctx.httpServer)
        .put(`/api/v1/cameras/${cam1}`)
        .set(auth(token))
        .send({ name: 'x' });
      expect(cam.status).toBe(403);
      const zone = await request(ctx.httpServer)
        .post(`/api/v1/cameras/${cam1}/zones`)
        .set(auth(token))
        .send({
          x: 10.5,
          y: 20,
          width: 30,
          height: 40,
          alertType: 'intruder',
        });
      expect(zone.status).toBe(403);
    });

    it('sees only the events of its cameras once granted the events section', async () => {
      const { owner, cam1, cam2, ownerToken } = await world();
      const guest = await seedMember(ctx.prisma, owner.spaceId, 'g@e.com', {
        role: 'guest',
        cameraIds: [cam1],
      });
      const token = await login(guest.email);
      const seed = (cameraId: string | null) =>
        ctx.prisma.alertEvent.create({
          data: {
            spaceId: owner.spaceId,
            cameraId,
            cameraLabelSnapshot: 'L',
            alertType: 'intruder',
            detectedAt: new Date(),
          },
        });
      const own = await seed(cam1);
      const foreign = await seed(cam2);
      await seed(null);

      expect((await get(token, '/events')).status).toBe(403);
      const granted = await patchMember(ownerToken, guest.userId, {
        menuAccess: ['home', 'monitor', 'events'],
      });
      expect(granted.status).toBe(200);

      const list = await get(token, '/events');
      expect(list.status).toBe(200);
      expect(typedBody<EventListBody>(list).items.map((e) => e.id)).toEqual([
        own.id,
      ]);
      expect((await get(token, `/events/${foreign.id}`)).status).toBe(404);
    });
  });

  describe('recorder visibility', () => {
    it('refuses GET /dvr to a guest without the dvr section, and /auth/me tells hasDvr', async () => {
      const owner = await seedTenant(ctx.prisma, 'owner@example.com', 'Main');
      const guest = await seedMember(ctx.prisma, owner.spaceId, 'g@e.com', {
        role: 'guest',
      });
      const token = await login(guest.email);
      const hasDvr = async () =>
        typedBody<{ currentSpace: { hasDvr: boolean } }>(
          await get(token, '/auth/me'),
        ).currentSpace.hasDvr;

      expect(await hasDvr()).toBe(false);
      await seedDvrWithCameras(ctx.prisma, owner.spaceId, 1);

      expect(await hasDvr()).toBe(true);
      expect((await get(token, '/dvr')).status).toBe(403);
    });
  });

  describe('collaborator', () => {
    it('edits zones and routings but does not invite', async () => {
      const { owner, cam1 } = await world();
      const member = await seedMember(ctx.prisma, owner.spaceId, 'c@e.com');
      const token = await login(member.email);

      const zone = await request(ctx.httpServer)
        .post(`/api/v1/cameras/${cam1}/zones`)
        .set(auth(token))
        .send({
          x: 10.5,
          y: 20,
          width: 30,
          height: 40,
          alertType: 'intruder',
        });
      expect(zone.status).toBe(201);
      const routing = await request(ctx.httpServer)
        .put('/api/v1/alert-routings')
        .set(auth(token))
        .send({
          items: [{ alertType: 'intruder', channel: 'call', enabled: true }],
        });
      expect(routing.status).toBe(200);
      const invite = await request(ctx.httpServer)
        .post('/api/v1/invitations')
        .set(auth(token))
        .send({ email: 'x@example.com', role: 'guest' });
      expect(invite.status).toBe(403);
    });

    it('loses a section on the next request, without a new login', async () => {
      const { owner, ownerToken } = await world();
      const member = await seedMember(ctx.prisma, owner.spaceId, 'c@e.com');
      const token = await login(member.email);
      expect((await get(token, '/events')).status).toBe(200);

      await patchMember(ownerToken, member.userId, { menuAccess: ['home'] });

      expect((await get(token, '/events')).status).toBe(403);
    });
  });

  describe('PATCH /members/:userId', () => {
    it('resets the menu to the new role defaults when only the role changes', async () => {
      const { owner, cam1, cam2, ownerToken } = await world();
      const guest = await seedMember(ctx.prisma, owner.spaceId, 'g@e.com', {
        role: 'guest',
        cameraIds: [cam1],
      });
      const token = await login(guest.email);

      const res = await patchMember(ownerToken, guest.userId, {
        role: 'collaborator',
      });

      expect(res.status).toBe(200);
      expect(typedBody<MemberBody>(res)).toMatchObject({
        role: 'collaborator',
        menuAccess: ['home', 'monitor', 'events', 'dvr', 'channels'],
      });
      const cameras = typedBody<IdBody[]>(await get(token, '/cameras'));
      expect(cameras.map((c) => c.id).sort()).toEqual([cam1, cam2].sort());
    });

    it('validates cameraIds and menuAccess', async () => {
      const { owner, ownerToken } = await world();
      const member = await seedMember(ctx.prisma, owner.spaceId, 'c@e.com');
      const other = await seedTenant(ctx.prisma, 'other@e.com', 'Other');
      const [foreign] = await seedDvrWithCameras(ctx.prisma, other.spaceId, 1);

      const cams = await patchMember(ownerToken, member.userId, {
        cameraIds: [foreign],
      });
      expect(cams.status).toBe(400);
      expect(typedBody<ErrorBody>(cams).code).toBe('VALIDATION_ERROR');
      const menu = await patchMember(ownerToken, member.userId, {
        menuAccess: ['nope'],
      });
      expect(menu.status).toBe(400);
    });

    it('keeps the sole admin: no self role change, no self removal, self alert toggle allowed', async () => {
      const { owner, ownerToken } = await world();

      const demote = await patchMember(ownerToken, owner.userId, {
        role: 'collaborator',
      });
      expect(demote.status).toBe(409);
      expect(typedBody<ErrorBody>(demote).code).toBe('CONFLICT');
      const row = await ctx.prisma.spaceMember.findUniqueOrThrow({
        where: {
          spaceId_userId: { spaceId: owner.spaceId, userId: owner.userId },
        },
      });
      expect(row.role).toBe('admin');

      const removal = await request(ctx.httpServer)
        .delete(`/api/v1/members/${owner.userId}`)
        .set(auth(ownerToken));
      expect(removal.status).toBe(409);

      const toggle = await patchMember(ownerToken, owner.userId, {
        receiveAlerts: false,
      });
      expect(toggle.status).toBe(200);
    });

    it('lets an admin demote another admin', async () => {
      const { owner, ownerToken } = await world();
      const second = await seedMember(ctx.prisma, owner.spaceId, 'a2@e.com', {
        role: 'admin',
      });

      const res = await patchMember(ownerToken, second.userId, {
        role: 'collaborator',
      });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /members/:userId', () => {
    it('removes the member, forgets the last space and locks the token out', async () => {
      const { owner, ownerToken } = await world();
      const member = await seedMember(ctx.prisma, owner.spaceId, 'c@e.com');
      await ctx.prisma.user.update({
        where: { id: member.userId },
        data: { lastSpaceId: owner.spaceId },
      });
      const token = await login(member.email);

      const res = await request(ctx.httpServer)
        .delete(`/api/v1/members/${member.userId}`)
        .set(auth(ownerToken));

      expect(res.status).toBe(204);
      expect(
        await ctx.prisma.spaceMember.count({
          where: { spaceId: owner.spaceId, userId: member.userId },
        }),
      ).toBe(0);
      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: member.userId },
      });
      expect(user.lastSpaceId).toBeNull();
      expect((await get(token, '/cameras')).status).toBe(403);
    });

    it('refuses a non-admin and answers 404 for an unknown user', async () => {
      const { owner, ownerToken } = await world();
      const member = await seedMember(ctx.prisma, owner.spaceId, 'c@e.com');
      const token = await login(member.email);

      const forbidden = await request(ctx.httpServer)
        .delete(`/api/v1/members/${owner.userId}`)
        .set(auth(token));
      expect(forbidden.status).toBe(403);
      const missing = await request(ctx.httpServer)
        .delete('/api/v1/members/999999')
        .set(auth(ownerToken));
      expect(missing.status).toBe(404);
    });
  });

  describe('GET /members', () => {
    it('shows permissions to an admin only', async () => {
      const { owner, ownerToken } = await world();
      const viewer = await seedMember(ctx.prisma, owner.spaceId, 'v@e.com', {
        menuAccess: [...DEFAULT_MENU_ACCESS.collaborator, 'members'],
      });
      const plain = await seedMember(ctx.prisma, owner.spaceId, 'p@e.com');

      const asAdmin = typedBody<MemberListBody>(
        await get(ownerToken, '/members'),
      );
      expect(asAdmin.items[0]).toMatchObject({ role: 'admin' });
      expect(asAdmin.items[0].menuAccess).toEqual(DEFAULT_MENU_ACCESS.admin);
      expect(asAdmin.items[0].cameraIds).toEqual([]);

      const viewerToken = await login(viewer.email);
      const asViewer = await get(viewerToken, '/members');
      expect(asViewer.status).toBe(200);
      for (const row of typedBody<MemberListBody>(asViewer).items) {
        expect(row.role).toBeDefined();
        expect(row).not.toHaveProperty('menuAccess');
        expect(row).not.toHaveProperty('cameraIds');
      }
      expect((await get(viewerToken, '/invitations')).status).toBe(200);

      const plainToken = await login(plain.email);
      expect((await get(plainToken, '/members')).status).toBe(403);
    });
  });
});
