/**
 * Sprint IX — wrap embed/synth: drugi raz ten sam input → cache hit (LRU).
 * Bez Mongo (graceful), tylko warstwa L1.
 */
process.env.ECONOMIZER_ENABLED = 'true';

import { wrapEmbed, wrapSynthesize, __clearEconomizerCaches } from '../../src/infrastructure/ai/economizer';
import { economizerMetrics } from '../../src/infrastructure/ai/economizer/metrics';

describe('economizer wrap', () => {
  beforeEach(() => {
    __clearEconomizerCaches();
    economizerMetrics.reset();
  });

  it('embed: drugi raz ten sam tekst → tylko 1 wywołanie providera', async () => {
    const provider = jest.fn().mockResolvedValue({
      vector: [0.1, 0.2, 0.3], dimensions: 3, provider: 'sim', model: 'm1'
    });
    const cached = wrapEmbed(provider);

    const r1 = await cached({ text: 'cześć świat' });
    const r2 = await cached({ text: 'CZEŚĆ ŚWIAT' });   // canonicalize → ten sam klucz

    expect(provider).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);

    const snap = economizerMetrics.snapshot();
    expect(snap.embed.requests).toBe(2);
    expect(snap.embed.cacheHits).toBe(1);
    expect(snap.embed.misses).toBe(1);
    expect(snap.embed.tokensSaved).toBeGreaterThan(0);
  });

  it('embed: różne modele → różne wpisy w cache', async () => {
    const provider = jest.fn()
      .mockResolvedValueOnce({ vector: [1], dimensions: 1, provider: 'sim', model: 'a' })
      .mockResolvedValueOnce({ vector: [2], dimensions: 1, provider: 'sim', model: 'b' });
    const cached = wrapEmbed(provider);

    await cached({ text: 'foo', model: 'a' });
    await cached({ text: 'foo', model: 'b' });

    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('synth: drugi raz ten sam tekst+voice → cache hit', async () => {
    const provider = jest.fn().mockResolvedValue({
      audioBase64: 'AAAA', mimeType: 'audio/wav', provider: 'sim'
    });
    const cached = wrapSynthesize(provider);

    await cached({ text: 'powiedz to', voiceName: 'pl-1' });
    await cached({ text: 'POWIEDZ TO', voiceName: 'pl-1' });

    expect(provider).toHaveBeenCalledTimes(1);
    const snap = economizerMetrics.snapshot();
    expect(snap.synth.cacheHits).toBe(1);
  });

  it('synth: różny voice → cache miss', async () => {
    const provider = jest.fn()
      .mockResolvedValueOnce({ audioBase64: 'A', mimeType: 'audio/wav', provider: 'sim' })
      .mockResolvedValueOnce({ audioBase64: 'B', mimeType: 'audio/wav', provider: 'sim' });
    const cached = wrapSynthesize(provider);

    await cached({ text: 'hej', voiceName: 'v1' });
    await cached({ text: 'hej', voiceName: 'v2' });

    expect(provider).toHaveBeenCalledTimes(2);
  });
});

describe('economizer wrap (disabled)', () => {
  const original = process.env.ECONOMIZER_ENABLED;

  afterEach(() => {
    process.env.ECONOMIZER_ENABLED = original;
    jest.resetModules();
  });

  it('gdy ECONOMIZER_ENABLED=false → pure pass-through', async () => {
    jest.resetModules();
    process.env.ECONOMIZER_ENABLED = 'false';
    const { wrapEmbed: w } = await import('../../src/infrastructure/ai/economizer');

    const provider = jest.fn().mockResolvedValue({
      vector: [1], dimensions: 1, provider: 'sim', model: 'm'
    });
    const cached = w(provider);

    await cached({ text: 'x' });
    await cached({ text: 'x' });
    expect(provider).toHaveBeenCalledTimes(2);
  });
});
