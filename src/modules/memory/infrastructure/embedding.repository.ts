import { randomUUID } from 'crypto';
import { getPostgres, isPgvectorReady } from '../../../infrastructure/database/postgres';
import { executeService } from '../../../infrastructure/ai/execute.service';
import { appConfig } from '../../../core/config/app.config';
import { economizerMetrics } from '../../../infrastructure/ai/economizer/metrics';

export interface MemoryFragment {
  id: string;
  sessionId: string;
  text: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Repozytorium pamięci wektorowej (RAG).
 * Backend pgvector + fallback in-memory (cosine similarity liczona ręcznie).
 *
 * Sprint IX: semantic dedup w ingest — jeśli istnieje fragment z
 * cosine ≥ economizer.dedupThreshold w tej samej sesji, reuse zamiast insert.
 */
class EmbeddingRepository {
  private memory = new Map<string, { id: string; sessionId: string; text: string; vector: number[]; metadata?: any }>();

  async ingest(sessionId: string, text: string, metadata?: Record<string, unknown>): Promise<MemoryFragment> {
    const { vector } = await executeService.embed({ text });

    // Sprint IX: semantic dedup — szukaj near-duplicate w tej samej sesji.
    if (appConfig.economizer.enabled && appConfig.economizer.dedupEnabled) {
      const dup = await this.findNearDuplicate(sessionId, vector, appConfig.economizer.dedupThreshold);
      if (dup) {
        economizerMetrics.recordEmbedDedupHit(text);
        return dup;
      }
    }

    const id = randomUUID();
    const pg = getPostgres();

    if (pg && isPgvectorReady() && vector.length === appConfig.vector.dimensions) {
      // pgvector format: '[0.1,0.2,...]'
      await pg.query(
        `INSERT INTO memory_embeddings (id, session_id, text, embedding, metadata)
         VALUES ($1, $2, $3, $4::vector, $5)`,
        [id, sessionId, text, this.toVectorLiteral(vector), metadata ?? null]
      );
    } else {
      this.memory.set(id, { id, sessionId, text, vector, metadata });
    }
    return { id, sessionId, text, metadata };
  }

  /**
   * Szuka fragmentu z cosine similarity ≥ threshold w danej sesji.
   * Postgres: top-1 nearest neighbor + filtr po similarity.
   * Memory: ręczne cosine.
   */
  private async findNearDuplicate(
    sessionId: string,
    vector: number[],
    threshold: number
  ): Promise<MemoryFragment | null> {
    const pg = getPostgres();
    if (pg && isPgvectorReady() && vector.length === appConfig.vector.dimensions) {
      try {
        const { rows } = await pg.query(
          `SELECT id, session_id, text, metadata, 1 - (embedding <=> $2::vector) AS similarity
             FROM memory_embeddings
            WHERE session_id = $1
            ORDER BY embedding <=> $2::vector ASC
            LIMIT 1`,
          [sessionId, this.toVectorLiteral(vector)]
        );
        const top = rows[0];
        if (top && Number(top.similarity) >= threshold) {
          return {
            id: top.id,
            sessionId: top.session_id,
            text: top.text,
            similarity: Number(top.similarity),
            metadata: top.metadata
          };
        }
      } catch {
        // bezpiecznie ignorujemy — dedup to optymalizacja, nie wymóg poprawności
      }
      return null;
    }
    // in-mem fallback
    for (const c of this.memory.values()) {
      if (c.sessionId !== sessionId) continue;
      const sim = this.cosine(vector, c.vector);
      if (sim >= threshold) {
        return { id: c.id, sessionId: c.sessionId, text: c.text, similarity: sim, metadata: c.metadata };
      }
    }
    return null;
  }

  /**
   * Sprint X: batch ingest. Embeddingi liczone jednym wywołaniem providera
   * (batchEmbedContents — Gemini), dedup nadal działa per-chunk po lookupie.
   *
   * Korzyść: dla 50 chunków robimy 1 HTTP zamiast 50, kasując O(N) latencji
   * na ingestach z plików.
   */
  async ingestMany(sessionId: string, chunks: string[], metadata?: Record<string, unknown>): Promise<MemoryFragment[]> {
    if (chunks.length === 0) return [];
    if (!appConfig.economizer.batchEnabled) {
      const out: MemoryFragment[] = [];
      for (const c of chunks) out.push(await this.ingest(sessionId, c, metadata));
      return out;
    }

    const { vectors } = await executeService.embedBatch({ texts: chunks });
    const out: MemoryFragment[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i];
      const vector = vectors[i];

      if (appConfig.economizer.enabled && appConfig.economizer.dedupEnabled) {
        const dup = await this.findNearDuplicate(sessionId, vector, appConfig.economizer.dedupThreshold);
        if (dup) {
          economizerMetrics.recordEmbedDedupHit(text);
          out.push(dup);
          continue;
        }
      }

      const id = randomUUID();
      const pg = getPostgres();
      if (pg && isPgvectorReady() && vector.length === appConfig.vector.dimensions) {
        await pg.query(
          `INSERT INTO memory_embeddings (id, session_id, text, embedding, metadata)
           VALUES ($1, $2, $3, $4::vector, $5)`,
          [id, sessionId, text, this.toVectorLiteral(vector), metadata ?? null]
        );
      } else {
        this.memory.set(id, { id, sessionId, text, vector, metadata });
      }
      out.push({ id, sessionId, text, metadata });
    }
    return out;
  }

  async search(sessionId: string, query: string, topK = appConfig.vector.topK): Promise<MemoryFragment[]> {
    if (!query.trim()) return [];
    const { vector } = await executeService.embed({ text: query });
    const pg = getPostgres();

    if (pg && isPgvectorReady() && vector.length === appConfig.vector.dimensions) {
      const { rows } = await pg.query(
        `SELECT id, session_id, text, metadata, 1 - (embedding <=> $2::vector) AS similarity
           FROM memory_embeddings
          WHERE session_id = $1
          ORDER BY embedding <=> $2::vector ASC
          LIMIT $3`,
        [sessionId, this.toVectorLiteral(vector), topK]
      );
      return rows.map(r => ({
        id: r.id,
        sessionId: r.session_id,
        text: r.text,
        similarity: Number(r.similarity),
        metadata: r.metadata
      }));
    }

    // fallback: in-memory cosine
    const candidates = Array.from(this.memory.values()).filter(c => c.sessionId === sessionId);
    return candidates
      .map(c => ({
        id: c.id, sessionId: c.sessionId, text: c.text, metadata: c.metadata,
        similarity: this.cosine(vector, c.vector)
      }))
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
      .slice(0, topK);
  }

  async buildContext(sessionId: string, query: string): Promise<string> {
    const fragments = await this.search(sessionId, query);
    if (!fragments.length) return '';
    return fragments
      .map((f, i) => `(${i + 1}, sim=${(f.similarity ?? 0).toFixed(3)})\n${f.text}`)
      .join('\n\n---\n\n');
  }

  private toVectorLiteral(v: number[]): string {
    return `[${v.join(',')}]`;
  }

  private cosine(a: number[], b: number[]): number {
    if (!a.length || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }
}

export const embeddingRepository = new EmbeddingRepository();
