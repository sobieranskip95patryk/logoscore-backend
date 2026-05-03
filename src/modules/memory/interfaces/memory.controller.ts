import { Response, NextFunction } from 'express';
import { intentMapRepository } from '../infrastructure/intent-map.repository';
import { embeddingRepository } from '../infrastructure/embedding.repository';
import { eventBus } from '../../../core/events/event-bus';
import { AuthenticatedRequest } from '../../../shared/middleware/auth.middleware';
import { IntentMapResponseDTO } from '../../../shared/dto';
import { parseDocument, chunkText } from '../../../shared/utils/document-parsers';
import { emptyGraph } from '../domain/intent-graph.entity';

export class MemoryController {
  static async getIntentMap(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sessionId = String(req.query.sessionId || req.user?.uid || 'anonymous');
      const entity = await intentMapRepository.get(sessionId);
      const payload: IntentMapResponseDTO = {
        sessionId,
        map: entity?.map || 'POCZĄTEK MAPOWANIA WIZJI',
        updatedAt: entity?.updatedAt ?? null
      };
      res.json(payload);
    } catch (e) { next(e); }
  }

  static async getIntentGraph(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sessionId = String(req.query.sessionId || req.user?.uid || 'anonymous');
      const entity = await intentMapRepository.get(sessionId);
      res.json(entity?.graph ?? emptyGraph(sessionId));
    } catch (e) { next(e); }
  }

  static async updateIntentMap(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { newIntent, sessionId } = req.body;
      const entity = await intentMapRepository.append(sessionId, newIntent);
      // Indeksacja wektorowa fragmentu intencji
      embeddingRepository.ingest(sessionId, newIntent, { kind: 'intent.fragment' }).catch(() => {});
      eventBus.publish('memory.intent.updated', {
        fragment: newIntent,
        size: entity.map.length,
        nodes: entity.graph.nodes.length
      }, sessionId);
      res.json({ ok: true, map: entity.map, graph: entity.graph, updatedAt: entity.updatedAt });
    } catch (e) { next(e); }
  }

  static async ingestDocument(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { sessionId, content, mimeType, filename } = req.body || {};
      if (!sessionId || !content) {
        res.status(400).json({ error: 'sessionId_and_content_required' });
        return;
      }
      const isPdf = (mimeType === 'application/pdf') || /\.pdf$/i.test(filename || '');
      const raw: string | Buffer = isPdf ? Buffer.from(content, 'base64') : String(content);
      const doc = await parseDocument(raw, { mimeType, filename });
      const chunks = chunkText(doc.text);
      const fragments = await embeddingRepository.ingestMany(sessionId, chunks, {
        kind: 'document', format: doc.format, filename, ...doc.meta
      });
      eventBus.publish('memory.document.ingested', {
        format: doc.format, bytes: doc.bytes, chunks: fragments.length, filename
      }, sessionId);
      res.status(201).json({ ok: true, format: doc.format, chunks: fragments.length, bytes: doc.bytes });
    } catch (e) { next(e); }
  }

  static async search(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { sessionId, query, topK } = req.body || {};
      if (!sessionId || !query) {
        res.status(400).json({ error: 'sessionId_and_query_required' });
        return;
      }
      const fragments = await embeddingRepository.search(sessionId, query, topK);
      eventBus.publish('memory.search.completed', { query, hits: fragments.length }, sessionId);
      res.json({ fragments });
    } catch (e) { next(e); }
  }

  static async snapshot(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sessionId = String(req.body?.sessionId || req.user?.uid || '');
      if (!sessionId) {
        res.status(400).json({ error: 'sessionId_required' });
        return;
      }
      const result = await intentMapRepository.snapshot(sessionId, 'manual');
      if (!result.ok) {
        res.status(409).json(result);
        return;
      }
      res.status(201).json(result);
    } catch (e) { next(e); }
  }

  static async listSnapshots(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sessionId = String(req.query.sessionId || req.user?.uid || '');
      if (!sessionId) {
        res.status(400).json({ error: 'sessionId_required' });
        return;
      }
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 500);
      const from = req.query.from ? String(req.query.from) : undefined;
      const to   = req.query.to   ? String(req.query.to)   : undefined;
      const items = await intentMapRepository.listSnapshots(sessionId, { from, to, limit });
      res.json({ sessionId, count: items.length, snapshots: items });
    } catch (e) { next(e); }
  }
}
