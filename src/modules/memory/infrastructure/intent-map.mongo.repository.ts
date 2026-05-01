import { getMongo, isMongoReady } from '../../../infrastructure/database/mongo';
import { IntentModel, IntentAuditModel, auditExpiryFor } from './schemas/intent.schema';
import {
  IntentGraph, appendIntent, emptyGraph, graphToString
} from '../domain/intent-graph.entity';
import {
  IIntentMapRepository, IntentMapEntity, SnapshotResult,
  SnapshotEntry, SnapshotQuery
} from './intent-map.repository.interface';
import { MAX_INTENT_MAP_LENGTH } from '../../../shared/constants';
import { truncate } from '../../../shared/utils';
import { appConfig } from '../../../core/config/app.config';
import { eventBus } from '../../../core/events/event-bus';

/**
 * Living Memory adapter — persystencja grafu intencji w MongoDB.
 * Każda mutacja generuje wpis w `intent_audit` (append-only, timeline wizji).
 */
export class IntentMapMongoRepository implements IIntentMapRepository {
  readonly backend = 'mongo' as const;

  async get(sessionId: string): Promise<IntentMapEntity | null> {
    await getMongo();
    if (!isMongoReady()) return null;
    const doc = await IntentModel.findOne({ sessionId }).lean();
    if (!doc) return null;
    const graph = this.docToGraph(doc, sessionId);
    return {
      sessionId,
      map: truncate(graphToString(graph), MAX_INTENT_MAP_LENGTH),
      graph,
      updatedAt: doc.updatedAt?.toISOString() ?? null,
      version: doc.version
    };
  }

  async upsert(sessionId: string, graph: IntentGraph): Promise<IntentMapEntity> {
    await getMongo();
    const map = truncate(graphToString(graph), MAX_INTENT_MAP_LENGTH);
    const existing = await IntentModel.findOne({ sessionId }).lean();
    const versionBefore = existing?.version ?? 0;
    const versionAfter = versionBefore + 1;

    const updated = await IntentModel.findOneAndUpdate(
      { sessionId },
      {
        $set: {
          '@id': graph['@id'],
          context: graph['@context'],
          nodes: graph.nodes.map(n => ({ ...n, createdAt: new Date(n.createdAt) })),
          edges: graph.edges.map(e => ({ ...e, createdAt: new Date() })),
          version: versionAfter
        },
        $setOnInsert: { sessionId }
      },
      { upsert: true, new: true, lean: true }
    );

    await IntentAuditModel.create({
      sessionId,
      action: existing ? 'replace' : 'create',
      versionBefore,
      versionAfter,
      payload: { nodes: graph.nodes.length, edges: graph.edges.length },
      expiresAt: auditExpiryFor(existing ? 'replace' : 'create')
    });

    return {
      sessionId,
      map,
      graph,
      updatedAt: updated!.updatedAt?.toISOString() ?? new Date().toISOString(),
      version: versionAfter
    };
  }

  async append(sessionId: string, fragment: string): Promise<IntentMapEntity> {
    const current = await this.get(sessionId);
    const baseGraph = current?.graph ?? emptyGraph(sessionId);
    const nextGraph = appendIntent(baseGraph, fragment);
    const result = await this.upsert(sessionId, nextGraph);

    await IntentAuditModel.create({
      sessionId,
      action: 'append',
      fragment,
      versionBefore: current?.version ?? 0,
      versionAfter: result.version,
      expiresAt: auditExpiryFor('append')
    });

    // Auto-snapshot co N mutacji — kamień milowy wizji.
    const every = appConfig.audit.snapshotEvery;
    if (every > 0 && result.version && result.version % every === 0) {
      this.snapshot(sessionId, 'auto').catch(err => {
        // eslint-disable-next-line no-console
        console.warn('[memory] auto-snapshot failed:', (err as Error).message);
      });
    }

    return result;
  }

  async snapshot(sessionId: string, trigger: 'manual' | 'auto' = 'manual'): Promise<SnapshotResult> {
    await getMongo();
    if (!isMongoReady()) {
      return { sessionId, version: 0, trigger, ok: false, skippedReason: 'mongo_offline' };
    }
    const doc = await IntentModel.findOne({ sessionId }).lean();
    if (!doc) {
      return { sessionId, version: 0, trigger, ok: false, skippedReason: 'graph_not_found' };
    }
    await IntentAuditModel.create({
      sessionId,
      action: 'snapshot',
      versionAfter: doc.version,
      payload: {
        trigger,
        nodes: doc.nodes?.length ?? 0,
        edges: doc.edges?.length ?? 0,
        '@id': doc['@id'],
        context: doc.context,
        graph: { nodes: doc.nodes, edges: doc.edges }
      },
      expiresAt: null   // wieczny
    });
    eventBus.publish('memory.intent.updated', {
      sessionId, version: doc.version, snapshot: true, trigger
    }, sessionId);
    return { sessionId, version: doc.version, trigger, ok: true };
  }

  async listSnapshots(sessionId: string, query?: SnapshotQuery): Promise<SnapshotEntry[]> {
    await getMongo();
    if (!isMongoReady()) return [];

    const limit = Math.min(Math.max(query?.limit ?? 50, 1), 500);
    const filter: Record<string, unknown> = { sessionId, action: 'snapshot' };
    const range: Record<string, Date> = {};
    if (query?.from) range.$gte = new Date(query.from);
    if (query?.to)   range.$lte = new Date(query.to);
    if (Object.keys(range).length > 0) filter.createdAt = range;

    const rows = await IntentAuditModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return rows.map(r => ({
      sessionId: r.sessionId,
      version: r.versionAfter ?? 0,
      trigger: ((r.payload as { trigger?: 'manual' | 'auto' })?.trigger) ?? 'manual',
      createdAt: r.createdAt.toISOString(),
      nodes: ((r.payload as { nodes?: number })?.nodes) ?? 0,
      edges: ((r.payload as { edges?: number })?.edges) ?? 0
    }));
  }

  async purgeSession(sessionId: string): Promise<number> {
    await getMongo();
    if (!isMongoReady()) return 0;
    const [graphResult, auditResult] = await Promise.all([
      IntentModel.deleteMany({ sessionId }),
      IntentAuditModel.deleteMany({ sessionId })
    ]);
    return (graphResult.deletedCount ?? 0) + (auditResult.deletedCount ?? 0);
  }

  private docToGraph(doc: any, sessionId: string): IntentGraph {
    return {
      '@context': doc.context ?? emptyGraph(sessionId)['@context'],
      '@id': doc['@id'] ?? `session:${sessionId}`,
      nodes: (doc.nodes ?? []).map((n: any) => ({
        '@id': n['@id'],
        '@type': 'Intent',
        text: n.text,
        createdAt: (n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt)).toISOString()
      })),
      edges: (doc.edges ?? []).map((e: any) => ({
        '@id': e['@id'],
        '@type': 'IntentLink',
        from: e.from,
        to: e.to,
        weight: e.weight ?? 0.8
      }))
    };
  }
}
