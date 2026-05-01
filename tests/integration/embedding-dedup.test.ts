/**
 * Sprint IX — semantic dedup w embeddingRepository.ingest.
 * Bez Postgres → in-mem fallback. Provider deterministyczny dla powtarzalnego cosine.
 */
process.env.AI_PROVIDER = 'simulated';
process.env.ECONOMIZER_ENABLED = 'true';
process.env.ECONOMIZER_DEDUP_ENABLED = 'true';
process.env.ECONOMIZER_DEDUP_THRESHOLD = '0.97';

import { embeddingRepository } from '../../src/modules/memory/infrastructure/embedding.repository';
import { economizerMetrics } from '../../src/infrastructure/ai/economizer/metrics';
import { __clearEconomizerCaches } from '../../src/infrastructure/ai/economizer';

describe('embedding semantic dedup', () => {
  beforeEach(() => {
    __clearEconomizerCaches();
    economizerMetrics.reset();
  });

  it('ten sam tekst → dedup hit, zwraca istniejący fragment', async () => {
    const sessionId = 'sess-dedup-1';
    const f1 = await embeddingRepository.ingest(sessionId, 'powtarzalna intencja');
    const before = economizerMetrics.snapshot().embed.dedupHits;

    const f2 = await embeddingRepository.ingest(sessionId, 'powtarzalna intencja');

    expect(f2.id).toBe(f1.id);
    const after = economizerMetrics.snapshot().embed.dedupHits;
    expect(after).toBe(before + 1);
  });

  it('zupełnie inny tekst → nowy fragment', async () => {
    const sessionId = 'sess-dedup-2';
    const f1 = await embeddingRepository.ingest(sessionId, 'pierwszy unikalny ciąg AAA');
    const f2 = await embeddingRepository.ingest(sessionId, 'totalnie inny temat ZZZ');
    expect(f2.id).not.toBe(f1.id);
  });

  it('dedup jest scoped per-sessionId', async () => {
    const text = 'wspólna fraza między sesjami';
    const f1 = await embeddingRepository.ingest('sess-A', text);
    const f2 = await embeddingRepository.ingest('sess-B', text);
    // Cache embed hit (ten sam tekst) ale dedup szuka tylko w obrębie sess-B
    expect(f2.id).not.toBe(f1.id);
  });
});
