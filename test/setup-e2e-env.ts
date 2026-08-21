import 'dotenv/config';

if (
  !process.env.DATABASE_URL_TEST ||
  !process.env.DATABASE_URL_TEST.includes('test')
) {
  throw new Error(
    'DATABASE_URL_TEST must be set and must point at a test database',
  );
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.POLLING_ENABLED = 'false';
process.env.OTEL_ENABLED = 'false';
// dotenv above has already loaded the developer's .env. AuthModule picks its
// delivery adapter from this switch and the e2e harness does not override the
// port, so leaving it on would send real mail from the suite.
process.env.MAIL_ENABLED = 'false';
// `GET /cameras/:id/live` now checks this switch before any database work, and
// the harness overrides the publisher port with a fake, so the suite needs the
// switch on to reach the live routes at all. No media server is contacted.
process.env.MEDIAMTX_ENABLED = 'true';
