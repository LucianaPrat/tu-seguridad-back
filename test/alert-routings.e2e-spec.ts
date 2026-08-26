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

type AlertType = 'intruder' | 'suspicious';
type AlertChannel = 'call' | 'whatsapp' | 'email';

interface AlertRoutingCell {
  alertType: AlertType;
  channel: AlertChannel;
  enabled: boolean;
}

interface AlertRoutingListBody {
  items: AlertRoutingCell[];
}

interface ErrorBody {
  code: string;
  message: string;
}

function cell(
  items: AlertRoutingCell[],
  alertType: AlertType,
  channel: AlertChannel,
): AlertRoutingCell | undefined {
  return items.find(
    (row) => row.alertType === alertType && row.channel === channel,
  );
}

describe('Alert routings (e2e)', () => {
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
  });

  function auth(bearer = token) {
    return { Authorization: `Bearer ${bearer}` };
  }

  function getRoutings(bearer = token) {
    return request(ctx.httpServer)
      .get('/api/v1/alert-routings')
      .set(auth(bearer))
      .send();
  }

  function putRoutings(body: object, bearer = token) {
    return request(ctx.httpServer)
      .put('/api/v1/alert-routings')
      .set(auth(bearer))
      .send(body);
  }

  it('answers the six-cell default grid for a space that never wrote any row', async () => {
    const res = await getRoutings();

    expect(res.status).toBe(200);
    const body = typedBody<AlertRoutingListBody>(res);
    expect(body.items).toHaveLength(6);
    expect(cell(body.items, 'intruder', 'email')).toEqual({
      alertType: 'intruder',
      channel: 'email',
      enabled: true,
    });
  });

  it('saves a partial grid, echoes all six cells, and persists the change', async () => {
    const res = await putRoutings({
      items: [{ alertType: 'intruder', channel: 'call', enabled: true }],
    });

    expect(res.status).toBe(200);
    const body = typedBody<AlertRoutingListBody>(res);
    expect(body.items).toHaveLength(6);
    expect(cell(body.items, 'intruder', 'call')).toMatchObject({
      enabled: true,
    });

    const after = typedBody<AlertRoutingListBody>(await getRoutings());
    expect(cell(after.items, 'intruder', 'call')).toMatchObject({
      enabled: true,
    });
    // Untouched cell keeps its previous (default) value.
    expect(cell(after.items, 'suspicious', 'call')).toMatchObject({
      enabled: false,
    });
  });

  it('refuses the write to a plain member of the space', async () => {
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

    const res = await putRoutings(
      { items: [{ alertType: 'intruder', channel: 'call', enabled: true }] },
      memberToken,
    );

    expect(res.status).toBe(403);
  });

  it('rejects an unknown channel value', async () => {
    const res = await putRoutings({
      items: [{ alertType: 'intruder', channel: 'sms', enabled: true }],
    });

    expect(res.status).toBe(400);
    expect(typedBody<ErrorBody>(res).code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-boolean enabled flag', async () => {
    const res = await putRoutings({
      items: [{ alertType: 'intruder', channel: 'call', enabled: 'yes' }],
    });

    expect(res.status).toBe(400);
    expect(typedBody<ErrorBody>(res).code).toBe('VALIDATION_ERROR');
  });

  it('rejects a routing list read without a token', async () => {
    const res = await request(ctx.httpServer).get('/api/v1/alert-routings');
    expect(res.status).toBe(401);
  });

  it("never leaks a write into another space's grid", async () => {
    const other = await seedTenant(
      ctx.prisma,
      'other-owner@example.com',
      'Other Space',
    );
    const otherToken = await loginAs(
      ctx.httpServer,
      other.email,
      other.password,
    );

    await putRoutings(
      { items: [{ alertType: 'intruder', channel: 'call', enabled: true }] },
      otherToken,
    );

    const mine = typedBody<AlertRoutingListBody>(await getRoutings());
    expect(cell(mine.items, 'intruder', 'call')).toMatchObject({
      enabled: false,
    });
  });
});
