/**
 * Sprint X — Redis L1 cache layer:
 *  - bez Redis: enabled()=false, get()=null, put() bez błędu
 *  - z Redis (mock): set/get round-trip + TTL
 */

describe('redis cache layer (no Redis configured)', () => {
  beforeAll(() => {
    process.env.REDIS_URL = '';
    jest.resetModules();
  });

  it('enabled()=false i operacje no-op gdy REDIS_URL pusty', async () => {
    const { redisCacheLayer } = await import('../../src/infrastructure/ai/economizer/redis-cache.layer');
    expect(redisCacheLayer.enabled()).toBe(false);
    await expect(redisCacheLayer.get('embed', 'k')).resolves.toBeNull();
    await expect(redisCacheLayer.put('embed', 'k', { x: 1 })).resolves.toBeUndefined();
  });
});

describe('redis cache layer (with mock Redis)', () => {
  beforeAll(() => {
    jest.resetModules();
    const store = new Map<string, string>();
    jest.doMock('../../src/infrastructure/database/redis', () => ({
      getRedis: () => ({
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string) => { store.set(k, v); return 'OK'; },
        call: async () => 'OK'
      }),
      pingRedis: async () => true
    }));
  });

  afterAll(() => {
    jest.dontMock('../../src/infrastructure/database/redis');
    jest.resetModules();
  });

  it('round-trip get/put działa, klucz ma prefix kind', async () => {
    process.env.ECONOMIZER_REDIS_CACHE_ENABLED = 'true';
    const { redisCacheLayer } = await import('../../src/infrastructure/ai/economizer/redis-cache.layer');
    expect(redisCacheLayer.enabled()).toBe(true);

    await redisCacheLayer.put('embed', 'abc', { vector: [1, 2], dimensions: 2 });
    const got = await redisCacheLayer.get<{ vector: number[]; dimensions: number }>('embed', 'abc');
    expect(got?.vector).toEqual([1, 2]);
    expect(got?.dimensions).toBe(2);

    // inny kind = miss
    const miss = await redisCacheLayer.get('synth', 'abc');
    expect(miss).toBeNull();
  });
});
