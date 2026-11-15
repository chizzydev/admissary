import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate, PostgresStateRepository } from '../scripts/postgres-state.mjs';
import { emptyProductApplicationState, emptyContinuousAssuranceState } from '../dist/index.js';

test('PostgreSQL preserves validated state across connections, concurrency, rollback and reseeding',
  { skip: !process.env.ADMISSARY_TEST_DATABASE_URL }, async () => {
    const connectionString = process.env.ADMISSARY_TEST_DATABASE_URL;
    const schema = 'test_' + randomUUID().replaceAll('-', '');
    const admin = new pg.Pool({ connectionString });
    let pool;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const connect = () => new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });
      pool = connect();
      await migrate(pool); await migrate(pool);
      let product = new PostgresStateRepository(pool, 'product');
      let assurance = new PostgresStateRepository(pool, 'assurance');
      await product.initialize(emptyProductApplicationState());
      await assurance.initialize(emptyContinuousAssuranceState());
      const event = id => ({ eventId: id, occurredAt: '2026-11-15T00:00:00Z', actorId: 'persistence-test', type: 'QUALIFICATION_REQUESTED', subjectId: id, detail: 'ACCEPTANCE_FIXTURE persistence only' });
      await Promise.all(Array.from({length: 12}, (_, i) => product.transact(s => { s.events.push(event('event-'+i)); })));
      assert.equal((await product.read()).revision, 12);
      await product.transact(() => {});
      assert.equal((await product.read()).revision, 12);
      await assurance.transact(() => {});
      assert.equal((await assurance.read()).revision, 1);
      await assert.rejects(product.transact(s => { s.events.push(event('rolled-back')); throw new Error('abort'); }), /abort/);
      await assert.rejects(product.transact(s => { s.schema = 'untrusted'; }), /schema/);
      const before = await product.read();
      await pool.end(); pool = connect();
      product = new PostgresStateRepository(pool, 'product');
      await product.initialize(emptyProductApplicationState());
      assert.deepEqual(await product.read(), before);
      assert.equal(before.events.length, 12);
      await pool.query("UPDATE admissary_schema_migrations SET digest='tampered' WHERE version=1");
      await assert.rejects(migrate(pool), /integrity mismatch/);
      await pool.query("UPDATE admissary_authority_state SET payload=jsonb_set(payload,'{schema}','\"untrusted\"') WHERE kind='product'");
      await assert.rejects(product.read(), /schema/);
    } finally {
      await pool?.end();
      // The schema is generated above; production state is never selected.
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
