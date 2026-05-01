import { IntentGraph } from '../domain/intent-graph.entity';

/**
 * Kontrakt repozytorium mapy intencji — silnik-agnostyczny.
 * Implementacje: Postgres (intent-map.repository.ts), Mongo (intent-map.mongo.repository.ts).
 */
export interface IntentMapEntity {
  sessionId: string;
  map: string;
  graph: IntentGraph;
  updatedAt: string | null;
  version?: number;
}

export interface SnapshotResult {
  sessionId: string;
  version: number;
  trigger: 'manual' | 'auto';
  ok: boolean;
  /** Powiedz dlaczego pominięto (np. backend nie wspiera). */
  skippedReason?: string;
}

export interface SnapshotEntry {
  sessionId: string;
  version: number;
  trigger: 'manual' | 'auto';
  createdAt: string;
  nodes: number;
  edges: number;
}

export interface SnapshotQuery {
  from?: string;   // ISO date inclusive
  to?: string;     // ISO date inclusive
  limit?: number;  // default 50, max 500
}

export interface IIntentMapRepository {
  get(sessionId: string): Promise<IntentMapEntity | null>;
  upsert(sessionId: string, graph: IntentGraph): Promise<IntentMapEntity>;
  append(sessionId: string, fragment: string): Promise<IntentMapEntity>;
  /** Tworzy wieczny snapshot stanu grafu w intent_audit (expiresAt=null). */
  snapshot(sessionId: string, trigger?: 'manual' | 'auto'): Promise<SnapshotResult>;
  /** Lista snapshotów dla sesji — timeline ewolucji intencji. Zwraca [] gdy backend nie wspiera. */
  listSnapshots(sessionId: string, query?: SnapshotQuery): Promise<SnapshotEntry[]>;
  /**
   * RODO cascade — usuwa cały graf + audyt + snapshoty dla sessionId.
   * Zwraca liczbę usuniętych dokumentów (best-effort; 0 gdy nic nie znaleziono).
   */
  purgeSession(sessionId: string): Promise<number>;
  /** Backend identifier — do logów i healthcheck. */
  readonly backend: 'postgres' | 'mongo' | 'memory';
}
