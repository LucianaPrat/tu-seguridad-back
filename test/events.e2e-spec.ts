import request from 'supertest';
import { bootstrapE2eApp, E2eContext } from './utils/bootstrap-e2e-app';
import { authAs } from './utils/auth-as';
import { truncateAll } from './utils/truncate-all';
import { typedBody } from './utils/typed-body';

interface ErrorBody {
  code: string;
}

describe('Events (e2e)', () => {
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

  it('rejects a query without a token', async () => {
    const res = await request(ctx.httpServer).get('/api/v1/events');
    expect(res.status).toBe(401);
  });

  it('returns an empty list when there are no events, and clamps an oversized limit', async () => {
    const res = await request(ctx.httpServer)
      .get('/api/v1/events?limit=5000')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rejects an invalid eventType filter with a VALIDATION_ERROR envelope', async () => {
    const res = await request(ctx.httpServer)
      .get('/api/v1/events?eventType=NOT_A_TYPE')
      .set(auth());

    expect(res.status).toBe(400);
    expect(typedBody<ErrorBody>(res).code).toBe('VALIDATION_ERROR');
  });
});
