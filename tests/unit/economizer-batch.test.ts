/**
 * Sprint X — wrapEmbedBatch:
 *  - wszystko z cache → 0 wywołań providera
 *  - mix hits/misses → tylko misses w batch-call providera
 *  - kolejność wektorów zachowana
 *  - różne modele = różne klucze
 */
process.env.ECONOMIZER_ENABLED = 'true';
process.env.ECONOMIZER_BATCH_ENABLED = 'true';
// Wymuszamy brak Redis aby test izolował L0+miss path.
process.env.REDIS_URL = '';

import {
  wrapEmbed, wrapEmbedBatch, __clearEconomizerCaches
} from '../../src/infrastructure/ai/economizer';
import { economizerMetrics } from '../../src/infrastructure/ai/economizer/metrics';
import { EmbedBatchInput, EmbedBatchOutput } from '../../src/infrastructure/ai/provider.types';

function deterministicVector(text: string, dim = 4): number[] {
  const v = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) v[i % dim] += text.charCodeAt(i);
  return v;
}

describe('economizer wrapEmbedBatch', () => {
  beforeEach(() => {
    __clearEconomizerCaches();
    economizerMetrics.reset();
  });

  it('wszystko z cache (po prewarm pojedynczym wrapEmbed) → 0 wywołań providera', async () => {
    const single = jest.fn(async (input) => ({
      vector: deterministicVector(input.text), dimensions: 4, provider: 'sim', model: 'm'
    }));
    const cachedSingle = wrapEmbed(single);

    // prewarm
    await cachedSingle({ text: 'alfa' });
    await cachedSingle({ text: 'beta' });
    expect(single).toHaveBeenCalledTimes(2);

    const batchProvider = jest.fn();
    const cachedBatch = wrapEmbedBatch(batchProvider as any);

    const out = await cachedBatch({ texts: ['alfa', 'BETA'] });

    expect(batchProvider).not.toHaveBeenCalled();
    expect(out.vectors).toHaveLength(2);
    expect(out.vectors[0]).toEqual(deterministicVector('alfa'));
    expect(out.vectors[1]).toEqual(deterministicVector('beta')); // canonicalize: BETA→beta
    expect(out.provider).toBe('cache');
  });

  it('mix hits/misses → tylko misses w jednym wywołaniu providera', async () => {
    const single = jest.fn(async (input) => ({
      vector: deterministicVector(input.text), dimensions: 4, provider: 'sim', model: 'm'
    }));
    const cachedSingle = wrapEmbed(single);
    await cachedSingle({ text: 'hit-a' });
    await cachedSingle({ text: 'hit-b' });

    const batchProvider = jest.fn(async (input: EmbedBatchInput): Promise<EmbedBatchOutput> => ({
      vectors: input.texts.map(t => deterministicVector(t)),
      dimensions: 4, provider: 'sim', model: 'm'
    }));
    const cachedBatch = wrapEmbedBatch(batchProvider);

    const out = await cachedBatch({ texts: ['hit-a', 'miss-1', 'hit-b', 'miss-2'] });

    expect(batchProvider).toHaveBeenCalledTimes(1);
    const arg = batchProvider.mock.calls[0][0] as EmbedBatchInput;
    expect(arg.texts).toEqual(['miss-1', 'miss-2']);

    // Kolejność wektorów zachowana w wyniku finalnym.
    expect(out.vectors[0]).toEqual(deterministicVector('hit-a'));
    expect(out.vectors[1]).toEqual(deterministicVector('miss-1'));
    expect(out.vectors[2]).toEqual(deterministicVector('hit-b'));
    expect(out.vectors[3]).toEqual(deterministicVector('miss-2'));

    const snap = economizerMetrics.snapshot();
    expect(snap.embed.cacheHits).toBeGreaterThanOrEqual(2);
    expect(snap.embed.misses).toBeGreaterThanOrEqual(2);
  });

  it('różne modele → różne klucze cache (miss w drugim modelu)', async () => {
    const batchProvider = jest.fn(async (input: EmbedBatchInput): Promise<EmbedBatchOutput> => ({
      vectors: input.texts.map(t => deterministicVector(t)),
      dimensions: 4, provider: 'sim', model: input.model || 'm'
    }));
    const cachedBatch = wrapEmbedBatch(batchProvider);

    await cachedBatch({ texts: ['x', 'y'], model: 'A' });
    await cachedBatch({ texts: ['x', 'y'], model: 'B' });

    expect(batchProvider).toHaveBeenCalledTimes(2);
  });

  it('pusty batch → szybki return bez wywołania providera', async () => {
    const batchProvider = jest.fn();
    const cachedBatch = wrapEmbedBatch(batchProvider as any);
    const out = await cachedBatch({ texts: [] });
    expect(batchProvider).not.toHaveBeenCalled();
    expect(out.vectors).toEqual([]);
  });

  it('mismatch długości odpowiedzi providera → throw', async () => {
    const broken = jest.fn(async (): Promise<EmbedBatchOutput> => ({
      vectors: [[1, 2]], dimensions: 2, provider: 'sim', model: 'm'
    }));
    const cachedBatch = wrapEmbedBatch(broken);
    await expect(cachedBatch({ texts: ['a', 'b', 'c'] })).rejects.toThrow(/length mismatch/);
  });
});
