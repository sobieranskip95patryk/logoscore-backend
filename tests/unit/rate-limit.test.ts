/**
 * Sprint VIII — rate limit factory unit test.
 * Sprawdza że no-op gdy rateLimitEnabled=false.
 */

describe('rate-limit middleware', () => {
  const original = process.env.RATE_LIMIT_ENABLED;

  afterEach(() => {
    process.env.RATE_LIMIT_ENABLED = original;
    jest.resetModules();
  });

  it('zwraca no-op gdy RATE_LIMIT_ENABLED=false', async () => {
    jest.resetModules();
    process.env.RATE_LIMIT_ENABLED = 'false';
    const { createRateLimit } = await import('../../src/shared/middleware/rate-limit.middleware');

    const mw = createRateLimit({ max: 1, windowMs: 1000 });
    const next = jest.fn();
    // Wywołujemy mw 5x — żaden nie powinien zablokować.
    for (let i = 0; i < 5; i++) {
      mw({} as any, {} as any, next);
    }
    expect(next).toHaveBeenCalledTimes(5);
  });

  it('zwraca rzeczywisty limiter gdy RATE_LIMIT_ENABLED=true (smoke check)', async () => {
    jest.resetModules();
    process.env.RATE_LIMIT_ENABLED = 'true';
    const { createRateLimit } = await import('../../src/shared/middleware/rate-limit.middleware');

    const mw = createRateLimit({ max: 100, windowMs: 60_000 });
    expect(typeof mw).toBe('function');
  });
});
