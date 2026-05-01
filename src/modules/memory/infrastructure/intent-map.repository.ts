import { getPostgres } from '../../../infrastructure/database/postgres';
import { IntentGraph, appendIntent, emptyGraph, graphToString } from '../domain/intent-graph.entity';
import {
  IIntentMapRepository, IntentMapEntity, SnapshotResult,
  SnapshotEntry, SnapshotQuery
} from './intent-map.repository.interface';
import { IntentMapMongoRepository } from './intent-map.mongo.repository';
import { isMongoReady, getMongo } from '../../../infrastructure/database/mongo';
import { appConfig } from '../../../core/config/app.config';
import { MAX_INTENT_MAP_LENGTH } from '../../../shared/constants';
import { truncate } from '../../../shared/utils';

/**
 * Postgres + in-memory adapter dla mapy intencji.
 * Implementuje IIntentMapRepository — zamienialny z Mongo bez zmian w use-case.
 */
class IntentMapPostgresRepository implements IIntentMapRepository {
  readonly backend = 'postgres' as const;
  private memory = new Map<string, IntentMapEntity>();

  async get(sessionId: string): Promise<IntentMapEntity | null> {
    const pg = getPostgres();
    if (!pg) return this.memory.get(sessionId) ?? null;

    const { rows } = await pg.query(
      'SELECT session_id, map, graph, updated_at FROM intent_maps WHERE session_id = $1',
      [sessionId]
    );
    if (rows.length === 0) return null;
    const graph: IntentGraph = rows[0].graph || emptyGraph(sessionId);
    return {
      sessionId: rows[0].session_id,
      map: rows[0].map,
      updatedAt: new Date(rows[0].updated_at).toISOString(),
      graph
    };
  }

  async upsert(sessionId: string, graph: IntentGraph): Promise<IntentMapEntity> {
    const map = truncate(graphToString(graph), MAX_INTENT_MAP_LENGTH);
    const pg = getPostgres();
    const updatedAt = new Date().toISOString();

    if (!pg) {
      const entity: IntentMapEntity = { sessionId, map, updatedAt, graph };
      this.memory.set(sessionId, entity);
      return entity;
    }

    await pg.query(
      `INSERT INTO intent_maps (session_id, map, graph, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (session_id) DO UPDATE SET map = EXCLUDED.map, graph = EXCLUDED.graph, updated_at = NOW()`,
      [sessionId, map, graph]
    );
    return { sessionId, map, updatedAt, graph };
  }

  async append(sessionId: string, fragment: string): Promise<IntentMapEntity> {
    const current = await this.get(sessionId);
    const baseGraph = current?.graph ?? emptyGraph(sessionId);
    const nextGraph = appendIntent(baseGraph, fragment);
    return this.upsert(sessionId, nextGraph);
  }

  async snapshot(sessionId: string, trigger: 'manual' | 'auto' = 'manual'): Promise<SnapshotResult> {
    // Postgres backend nie utrzymuje audit-trail — snapshot jest no-op.
    return {
      sessionId,
      version: 0,
      trigger,
      ok: false,
      skippedReason: 'postgres_backend_no_audit'
    };
  }

  async listSnapshots(_sessionId: string, _query?: SnapshotQuery): Promise<SnapshotEntry[]> {
    return [];
  }

  async purgeSession(sessionId: string): Promise<number> {
    const pg = getPostgres();
    if (!pg) {
      return this.memory.delete(sessionId) ? 1 : 0;
    }
    const result = await pg.query('DELETE FROM intent_maps WHERE session_id = $1', [sessionId]);
    return result.rowCount ?? 0;
  }
}

/**
 * Selektor adaptera — auto-discovery z fallbackiem.
 *
 * MEMORY_BACKEND:
 *   - 'mongo'    : wymuś Mongo (błąd jeśli nieosiągalny)
 *   - 'postgres' : wymuś Postgres
 *   - 'memory'   : in-memory (testy)
 *   - 'auto'     : Mongo jeśli MONGO_URL i ping OK, inaczej Postgres
 */
class IntentMapRepositoryProxy implements IIntentMapRepository {
  private impl: IIntentMapRepository = new IntentMapPostgresRepository();
  private resolved = false;

  get backend() { return this.impl.backend; }

  private async resolve(): Promise<IIntentMapRepository> {
    if (this.resolved) return this.impl;
    const mode = appConfig.memoryBackend;

    if (mode === 'postgres' || mode === 'memory') {
      this.impl = new IntentMapPostgresRepository();
    } else if (mode === 'mongo') {
      await getMongo();
      this.impl = new IntentMapMongoRepository();
    } else { // auto
      if (appConfig.mongoUrl) {
        await getMongo();
        if (isMongoReady()) {
          this.impl = new IntentMapMongoRepository();
        }
      }
    }
    this.resolved = true;
    console.log(`[memory] intent-map backend: ${this.impl.backend}`);
    return this.impl;
  }

  async get(sessionId: string) { return (await this.resolve()).get(sessionId); }
  async upsert(sessionId: string, graph: IntentGraph) { return (await this.resolve()).upsert(sessionId, graph); }
  async append(sessionId: string, fragment: string) { return (await this.resolve()).append(sessionId, fragment); }
  async snapshot(sessionId: string, trigger: 'manual' | 'auto' = 'manual') {
    return (await this.resolve()).snapshot(sessionId, trigger);
  }
  async listSnapshots(sessionId: string, query?: SnapshotQuery) {
    return (await this.resolve()).listSnapshots(sessionId, query);
  }
  async purgeSession(sessionId: string) {
    return (await this.resolve()).purgeSession(sessionId);
  }
}

export const intentMapRepository: IIntentMapRepository = new IntentMapRepositoryProxy();
