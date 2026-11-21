import request from 'supertest';
import { RouteThrottle } from '../src/cross/common/constants';
import { bootstrapE2eApp, E2eContext } from './utils/bootstrap-e2e-app';

/**
 * The only suite that boots with the real rate limiter in place. Every other
 * one turns it off, because they share one tracker (127.0.0.1) and would spend
 * their assertions on 429s — which is exactly the property being asserted here.
 */
describe('Rate limiting (e2e)', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await bootstrapE2eApp({ throttling: true });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const attemptLogin = () =>
    request(ctx.httpServer)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password-123' });

  it('refuses a credential route past its own limit, not the global one', async () => {
    const attempts = RouteThrottle.CREDENTIAL.limit + 1;
    const statuses: number[] = [];
    for (let i = 0; i < attempts; i += 1) {
      statuses.push((await attemptLogin()).status);
    }

    // The route's limit is well above the global ten-per-second, so a run that
    // stopped at the global one would never reach here.
    expect(statuses.slice(0, RouteThrottle.CREDENTIAL.limit)).not.toContain(
      429,
    );
    expect(statuses.at(-1)).toBe(429);
  });

  it('counts the rejection on the metrics endpoint', async () => {
    const token = process.env.METRICS_TOKEN;
    const res = token
      ? await request(ctx.httpServer)
          .get('/metrics')
          .set('X-Metrics-Token', token)
      : await request(ctx.httpServer).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/throttler_rejections_total\s+[1-9]/);
  });
});
