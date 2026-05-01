/**
 * Sprint X — batch ingest + dedup w jednym wywołaniu providera.
 */
process.env.AI_PROVIDER = 'simulated';
process.env.ECONOMIZER_ENABLED = 'true';
process.env.ECONOMIZER_BATCH_ENABLED = 'true';
process.env.ECONOMIZER_DEDUP_ENABLED = 'true';
process.env.ECONOMIZER_DEDUP_THRESHOLD = '0.97';

import { embeddingRepository } from '../../src/modules/memory/infrastructure/embedding.repository';
import { economizerMetrics } from '../../src/infrastructure/ai/economizer/metrics';
import { __clearEconomizerCaches } from '../../src/infrastructure/ai/economizer';
import { executeService } from '../../src/infrastructure/ai/execute.service';

describe('embeddingRepository.ingestMany (batch)', () => {
  beforeEach(() => {
    __clearEconomizerCaches();
    economizerMetrics.reset();
  });

  it('5 chunków, 2 duplikaty → 1 batch call do providera, 2 dedup hity', async () => {
    const sessionId = 'sess-batch-1';
    const spy = jest.spyOn(executeService, 'embedBatch');

    // Najpierw zaszczepiamy 2 fragmenty
    await embeddingRepository.ingestMany(sessionId, ['alfa unikalna', 'beta unikalna']);
    spy.mockClear();
    economizerMetrics.reset();

    // Teraz 5 chunków: 2 to dokładne powtórki (semantyczne dedup), 3 nowe.
    const chunks = ['alfa unikalna', 'gamma nowa', 'beta unikalna', 'delta nowa', 'epsilon nowa'];
    const out = await embeddingRepository.ingestMany(sessionId, chunks);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(5);

    const snap = economizerMetrics.snapshot();
    expect(snap.embed.dedupHits).toBeGreaterThanOrEqual(2);

    spy.mockRestore();
  });

  it('pusty input → szybki return, 0 wywołań providera', async () => {
    const spy = jest.spyOn(executeService, 'embedBatch');
    const out = await embeddingRepository.ingestMany('sess-empty', []);
    expect(spy).not.toHaveBeenCalled();
    expect(out).toEqual([]);
    spy.mockRestore();
  });
});
