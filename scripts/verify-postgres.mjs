import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCIFixture } from './ci-fixture.mjs';
import { ProductApplicationService, ContinuousAssuranceService, verifySignedQualificationAttestation } from '../dist/index.js';
import { pathToFileURL } from 'node:url';
import { migrate, PostgresStateRepository } from './postgres-state.mjs';
import { digestCanonicalJson, emptyProductApplicationState, emptyContinuousAssuranceState } from '../dist/index.js';

export async function verifyPostgres(connectionString) {
    const schema = 'test_' + randomUUID().replaceAll('-', '');
    const admin = new pg.Pool({ connectionString, connectionTimeoutMillis:10000 });
    let pool;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const connect = () => new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4, connectionTimeoutMillis:10000 });
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
      const fixtureDir = await mkdtemp(join(tmpdir(), 'admissary-postgres-fixture-'));
      try {
        const fixture = await createCIFixture(fixtureDir);
        const fixtureProduct = await fixture.repository.read();
        const fixtureAssurance = await fixture.assuranceRepository.read();
        await product.transact(s => Object.assign(s, fixtureProduct));
        assurance = new PostgresStateRepository(pool, 'assurance');
        await assurance.transact(s => Object.assign(s, fixtureAssurance));
        const service = () => new ProductApplicationService(new PostgresStateRepository(pool,'product'), new ContinuousAssuranceService(new PostgresStateRepository(pool,'assurance')), fixture.resolver, fixture.trust);
        assert.equal((await service().admitCurrentDeployment(fixture.deploymentId,fixture.context)).allowed,true);
        await pool.end(); pool=connect();
        assert.equal((await service().admitCurrentDeployment(fixture.deploymentId,fixture.context)).allowed,true);
        await service().revokeDeployment({deploymentId:fixture.deploymentId,actorId:'FIXTURE_OPERATOR',occurredAt:new Date().toISOString(),reason:'ACCEPTANCE_FIXTURE database revocation verification'});
        assert.equal((await service().admitCurrentDeployment(fixture.deploymentId,fixture.context)).allowed,false);
        assert.equal(verifySignedQualificationAttestation(fixture.attestation,fixture.trust).valid,true);
        await pool.end(); pool=connect();
        assert.equal((await service().admitCurrentDeployment(fixture.deploymentId,fixture.context)).allowed,false);
        product = new PostgresStateRepository(pool,'product');
      } finally { await rm(fixtureDir, {recursive:true,force:true}); }
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

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
  try {
    await migrate(pool);
    const before = (await pool.query('SELECT kind,revision,payload FROM admissary_authority_state ORDER BY kind')).rows;
    await verifyPostgres(process.env.DATABASE_URL);
    const after = (await pool.query('SELECT kind,revision,payload FROM admissary_authority_state ORDER BY kind')).rows;
    assert.deepEqual(after,before,'Production state changed during isolated preflight');
    for (const row of after) await new PostgresStateRepository(pool,row.kind).read();
    console.log(JSON.stringify({check:'POSTGRES_PRIVATE_PREFLIGHT',status:'PASS',migration:1,concurrency:12,rollback:'PASS',corruptionRejected:true,reconnect:'PASS',seedPreserved:true,fixtureAdmissionBeforeRevocation:'ALLOW',fixtureAdmissionAfterRevocation:'DENY',historicalSignatureAfterRevocation:'VALID',revocationSurvivesReconnect:true,productionStateUnchanged:true,stateDigest:digestCanonicalJson(after),revisions:after.map(r=>({kind:r.kind,revision:r.revision}))}));
  } finally {await pool.end();}
}
