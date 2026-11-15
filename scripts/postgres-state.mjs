import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateAuthorityState } from '../dist/persistence/validation.js';
import { digestCanonicalJson } from '../dist/qualification/canonical.js';

const schemas = { product: 'admissary-product-application/v1', assurance: 'admissary-continuous-assurance/v1' };
function validate(state, kind) {
  if (state?.schema !== schemas[kind]) throw new Error('Unsupported authority state schema');
  validateAuthorityState(state, kind);
}

// Immutable, transactional migrations. A changed applied migration fails startup.
export async function migrate(pool) {
  const sql = await readFile(new URL('../migrations/001_authority_state.sql', import.meta.url), 'utf8');
  const digest = createHash('sha256').update(sql).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(784233001)');
    await client.query('CREATE TABLE IF NOT EXISTS admissary_schema_migrations (version integer PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = await client.query('SELECT digest FROM admissary_schema_migrations WHERE version = 1');
    if (applied.rows.length) {
      if (applied.rows[0].digest !== digest) throw new Error('Applied migration integrity mismatch');
    } else {
      await client.query(sql);
      await client.query('INSERT INTO admissary_schema_migrations(version,digest) VALUES (1,$1)', [digest]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export class PostgresStateRepository {
  constructor(pool, kind) {
    if (!Object.hasOwn(schemas, kind)) throw new Error('Unsupported repository kind');
    this.pool = pool; this.kind = kind;
  }
  async initialize(seed) {
    validate(seed, this.kind);
    await this.pool.query('INSERT INTO admissary_authority_state(kind,revision,payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT (kind) DO NOTHING', [this.kind, seed.revision, JSON.stringify(seed)]);
    await this.read();
  }
  async read() {
    const { rows } = await this.pool.query('SELECT revision,payload FROM admissary_authority_state WHERE kind=$1', [this.kind]);
    if (rows.length !== 1) throw new Error('Missing persisted authority state');
    const state = rows[0].payload;
    validate(state, this.kind);
    if (String(state.revision) !== String(rows[0].revision)) throw new Error('Persisted revision mismatch');
    return structuredClone(state);
  }
  async transact(transaction) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT revision,payload FROM admissary_authority_state WHERE kind=$1 FOR UPDATE', [this.kind]);
      if (rows.length !== 1) throw new Error('Missing persisted authority state');
      const current = rows[0].payload;
      validate(current, this.kind);
      if (String(current.revision) !== String(rows[0].revision)) throw new Error('Persisted revision mismatch');
      const draft = structuredClone(current);
      const result = await transaction(draft);
      draft.revision = current.revision;
      validate(draft, this.kind);
      // Assurance increments on every successful transaction; Product only on change.
      if (this.kind === 'assurance' || digestCanonicalJson(current) !== digestCanonicalJson(draft)) {
        draft.revision = current.revision + 1;
        validate(draft, this.kind);
        await client.query('UPDATE admissary_authority_state SET revision=$2,payload=$3::jsonb,updated_at=now() WHERE kind=$1', [this.kind, draft.revision, JSON.stringify(draft)]);
      }
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

export async function openProductionDatabase(connectionString, seeds) {
  if (!connectionString) throw new Error('Production requires DATABASE_URL');
  const pool = new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('PostgreSQL connection unavailable'));
  try {
    await migrate(pool);
    const productRepository = new PostgresStateRepository(pool, 'product');
    const productAssuranceRepository = new PostgresStateRepository(pool, 'assurance');
    await productRepository.initialize(seeds.product);
    await productAssuranceRepository.initialize(seeds.assurance);
    return { productRepository, productAssuranceRepository,
      check: async () => { await productRepository.read(); await productAssuranceRepository.read(); },
      close: () => pool.end() };
  } catch (error) { await pool.end(); throw error; }
}
