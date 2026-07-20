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
