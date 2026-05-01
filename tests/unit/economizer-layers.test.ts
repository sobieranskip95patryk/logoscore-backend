/**
 * Sprint XI — per-warstwę cache layer counters w wrapEmbed/wrapEmbedBatch.
 * Pierwszy lookup → l0 hit po set. Symulujemy L1/L2 mockując redis-cache.layer
 * oraz ai-cache.repository przed importem economizera.
 */
process.env.ECONOMIZER_ENABLED = 'true';
process.env.ECONOMIZER_BATCH_ENABLED = 'true';
process.env.REDIS_URL = '';

describe('economizer per-layer counters', () => {
  let storeRedis = new Map<string, string>();
  let storeMongo = new Map<string, any>();

  beforeAll(() => {
    jest.resetModules();
    storeRedis = new Map();
    storeMongo = new Map();

    jest.doMock('../../src/infrastructure/ai/economizer/redis-cache.layer', () => ({
      redisCacheLayer: {
        enabled: () => true,
        get: async (_kind: string, key: string) => {
          const raw = storeRedis.get(key);
          return raw ? JSON.parse(raw) : null;
        },
        put: async (_kind: string, key: string, value: any) => {
          storeRedis.set(key, JSON.stringify(value));
        }
      }
    }));

    jest.doMock('../../src/infrastructure/ai/economizer/ai-cache.repository', () => ({
      aiCacheRepository: {
        get: async <T>(key: string) => {
          const v = storeMongo.get(key);
          return v ? { payload: v as T } : null;
        },
        put: async (key: string, _kind: string, _model: string, _text: string, payload: any) => {
          storeMongo.set(key, payload);
        }
      }
    }));
  });

  afterAll(() => {
    jest.dontMock('../../src/infrastructure/ai/economizer/redis-cache.layer');
    jest.dontMock('../../src/infrastructure/ai/economizer/ai-cache.repository');
    jest.resetModules();
  });

  it('drugi call dla tego samego tekstu → l0 hit', async () => {
    const { wrapEmbed, __clearEconomizerCaches } = await import('../../src/infrastructure/ai/economizer');
    const { economizerMetrics } = await import('../../src/infrastructure/ai/economizer/metrics');

    __clearEconomizerCaches();
    economizerMetrics.reset();
    storeRedis.clear();
    storeMongo.clear();

    const provider = jest.fn(async () => ({ vector: [1, 2], dimensions: 2, provider: 'sim', model: 'm' }));
    const cached = wrapEmbed(provider);

    await cached({ text: 'a' }); // miss → wpis L0+L1+L2
    await cached({ text: 'a' }); // hit z L0

    const snap = economizerMetrics.snapshot();
    expect(snap.embed.layerHits.l0).toBe(1);
    expect(snap.embed.layerHits.l1).toBe(0);
    expect(snap.embed.layerHits.l2).toBe(0);
  });

  it('miss w L0 ale hit w L1 (Redis) → l1 counter rośnie', async () => {
    const { wrapEmbed, __clearEconomizerCaches } = await import('../../src/infrastructure/ai/economizer');
    const { economizerMetrics } = await import('../../src/infrastructure/ai/economizer/metrics');
    const { cacheKey } = await import('../../src/infrastructure/ai/economizer/utils');

    __clearEconomizerCaches();
    economizerMetrics.reset();
    storeRedis.clear();
    storeMongo.clear();

    const key = cacheKey('foo', 'm');
    storeRedis.set(key, JSON.stringify({ vector: [3], dimensions: 1, provider: 'sim', model: 'm' }));

    const provider = jest.fn();
    const cached = wrapEmbed(provider as any);
    const out = await cached({ text: 'foo', model: 'm' });

    expect(provider).not.toHaveBeenCalled();
    expect(out.vector).toEqual([3]);

    const snap = economizerMetrics.snapshot();
    expect(snap.embed.layerHits.l1).toBe(1);
    expect(snap.embed.layerHits.l0).toBe(0);
  });

  it('miss w L0+L1 ale hit w L2 (Mongo) → l2 counter rośnie', async () => {
    const { wrapEmbed, __clearEconomizerCaches } = await import('../../src/infrastructure/ai/economizer');
    const { economizerMetrics } = await import('../../src/infrastructure/ai/economizer/metrics');
    const { cacheKey } = await import('../../src/infrastructure/ai/economizer/utils');

    __clearEconomizerCaches();
    economizerMetrics.reset();
    storeRedis.clear();
    storeMongo.clear();

    const key = cacheKey('bar', 'm');
    storeMongo.set(key, { vector: [9], dimensions: 1, provider: 'sim', model: 'm' });

    const provider = jest.fn();
    const cached = wrapEmbed(provider as any);
    const out = await cached({ text: 'bar', model: 'm' });

    expect(provider).not.toHaveBeenCalled();
    expect(out.vector).toEqual([9]);

    const snap = economizerMetrics.snapshot();
    expect(snap.embed.layerHits.l2).toBe(1);
    expect(snap.embed.layerHits.l0).toBe(0);
    expect(snap.embed.layerHits.l1).toBe(0);

    // Po hicie w L2 — Redis L1 powinien być hydratowany write-back.
    expect(storeRedis.has(key)).toBe(true);
  });

  it('snapshot eksponuje layerHitRates i latency.cacheLookupMs', async () => {
    const { economizerMetrics } = await import('../../src/infrastructure/ai/economizer/metrics');
    const snap = economizerMetrics.snapshot();
    expect(snap.embed.layerHitRates).toBeDefined();
    expect(snap.embed.layerHitRates.l0 + snap.embed.layerHitRates.l1 + snap.embed.layerHitRates.l2)
      .toBeCloseTo(snap.embed.layerHits.l0 + snap.embed.layerHits.l1 + snap.embed.layerHits.l2 ? 1 : 0);
    expect(snap.latency.cacheLookupMs.l0).toBeDefined();
    expect(snap.latency.cacheLookupMs.l1).toBeDefined();
    expect(snap.latency.cacheLookupMs.l2).toBeDefined();
    expect(snap.latency.embedTotalMs).toBeDefined();
    expect(snap.latency.providerEmbedMs).toBeDefined();
  });
});
