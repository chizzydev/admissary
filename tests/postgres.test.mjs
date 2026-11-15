import test from 'node:test';
import { verifyPostgres } from '../scripts/verify-postgres.mjs';

test('PostgreSQL preserves validated state across connections, concurrency, rollback and reseeding',
  { skip: !process.env.ADMISSARY_TEST_DATABASE_URL }, async () => {
    await verifyPostgres(process.env.ADMISSARY_TEST_DATABASE_URL);
  });
