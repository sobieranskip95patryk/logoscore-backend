import { Pool } from 'pg';
import { appConfig } from '../../core/config/app.config';

let pool: Pool | null = null;
let pgvectorReady = false;

export function getPostgres(): Pool | null {
  if (!appConfig.databaseUrl) return null;
  if (pool) return pool;
  pool = new Pool({ connectionString: appConfig.databaseUrl, max: 10 });
  pool.on('error', (err) => console.error('[postgres] pool error:', err.message));
  return pool;
}

export function isPgvectorReady(): boolean { return pgvectorReady; }

export async function pingPostgres(): Promise<boolean> {
  const p = getPostgres();
  if (!p) return false;
  try {
    await p.query('SELECT 1');
    return true;
  } catch (e) {
    console.error('[postgres] ping failed:', (e as Error).message);
    return false;
  }
}

export async function ensureSchema(): Promise<void> {
  const p = getPostgres();
  if (!p) return;

  // pgvector — best effort. Jeśli rozszerzenie niedostępne, embeddingi degradują się.
  if (appConfig.vector.enabled) {
    try {
      await p.query('CREATE EXTENSION IF NOT EXISTS vector');
      pgvectorReady = true;
    } catch (e) {
      console.warn('[postgres] pgvector unavailable:', (e as Error).message);
    }
  }

  await p.query(`
    CREATE TABLE IF NOT EXISTS intent_maps (
      session_id   TEXT PRIMARY KEY,
      map          TEXT NOT NULL,
      graph        JSONB,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS quests (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      parent_id    TEXT REFERENCES quests(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      state        TEXT NOT NULL,
      branch_key   TEXT,
      reward       JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS quests_parent_idx ON quests(parent_id);
    ALTER TABLE quests ADD COLUMN IF NOT EXISTS description          TEXT;
    ALTER TABLE quests ADD COLUMN IF NOT EXISTS acceptance_criteria  TEXT;
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      display_name TEXT,
      anonymous    BOOLEAN NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS inventory_items (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      item_key     TEXT NOT NULL,
      quantity     INT  NOT NULL DEFAULT 1,
      rarity       TEXT NOT NULL DEFAULT 'COMMON',
      soulbound    BOOLEAN NOT NULL DEFAULT FALSE,
      metadata     JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  if (pgvectorReady) {
    const dims = appConfig.vector.dimensions;
    await p.query(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        id          UUID PRIMARY KEY,
        session_id  TEXT NOT NULL,
        text        TEXT NOT NULL,
        embedding   vector(${dims}) NOT NULL,
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS memory_embeddings_session_idx ON memory_embeddings(session_id);
    `);
  }
}
