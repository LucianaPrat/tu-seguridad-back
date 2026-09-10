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
// dotenv above has already loaded the developer's .env. The event listener
// this switch turns on holds a permanent connection to the recorder, so
// leaving it on would have the suite dial a real appliance the moment the
// process boots.
process.env.DVR_EVENTS_ENABLED = 'false';
