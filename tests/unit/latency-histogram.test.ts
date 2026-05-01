/**
 * Sprint XI — LatencyHistogram (reservoir, percentyle, snapshot).
 */
import { LatencyHistogram } from '../../src/infrastructure/observability/latency-histogram';

describe('LatencyHistogram', () => {
  it('puste → snapshot zera', () => {
    const h = new LatencyHistogram();
    const s = h.snapshot();
    expect(s.count).toBe(0);
    expect(s.p50).toBe(0);
    expect(s.p95).toBe(0);
    expect(s.p99).toBe(0);
    expect(s.min).toBe(0);
    expect(s.max).toBe(0);
  });

  it('pojedyncze observe → wszystko ustawione', () => {
    const h = new LatencyHistogram();
    h.observe(42);
    const s = h.snapshot();
    expect(s.count).toBe(1);
    expect(s.min).toBe(42);
    expect(s.max).toBe(42);
    expect(s.mean).toBe(42);
    expect(s.p50).toBe(42);
  });

  it('100 wartości 1..100 → percentyle w przybliżeniu', () => {
    const h = new LatencyHistogram(200);
    for (let i = 1; i <= 100; i++) h.observe(i);
    const s = h.snapshot();
    expect(s.count).toBe(100);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.mean).toBeCloseTo(50.5, 0);
    expect(s.p50).toBeGreaterThanOrEqual(45);
    expect(s.p50).toBeLessThanOrEqual(55);
    expect(s.p95).toBeGreaterThanOrEqual(90);
    expect(s.p99).toBeGreaterThanOrEqual(95);
  });

  it('reset() zeruje wszystko', () => {
    const h = new LatencyHistogram();
    h.observe(1); h.observe(2); h.observe(3);
    h.reset();
    expect(h.snapshot().count).toBe(0);
  });

  it('reservoir nie rośnie powyżej capacity', () => {
    const h = new LatencyHistogram(10);
    for (let i = 0; i < 1000; i++) h.observe(i);
    const s = h.snapshot();
    expect(s.count).toBe(1000); // total count rośnie
    expect(s.max).toBe(999);
    // reservoir przechowuje max 10, ale percentyle dalej liczone
    expect(s.p50).toBeGreaterThanOrEqual(0);
  });
});
