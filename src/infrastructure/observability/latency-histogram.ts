/**
 * Sprint XI — lekki histogram latencji (in-process).
 * Reservoir sampling (Vitter R) o stałym rozmiarze — O(1) memory,
 * percentyle wyliczane na żądanie z posortowanej kopii reservoir.
 *
 * Brak zewnętrznych dependencies (HDR Histogram itp.) — observability
 * powinna mieć zero latency overhead na hot-path.
 */
export class LatencyHistogram {
  private samples: number[] = [];
  private count = 0;
  private sum = 0;
  private min = Infinity;
  private max = -Infinity;

  constructor(private readonly capacity = 1024) {}

  observe(ms: number): void {
    this.count++;
    this.sum += ms;
    if (ms < this.min) this.min = ms;
    if (ms > this.max) this.max = ms;

    if (this.samples.length < this.capacity) {
      this.samples.push(ms);
    } else {
      // Reservoir: zamień losowo (stała szansa = capacity/count).
      const r = Math.floor(Math.random() * this.count);
      if (r < this.capacity) this.samples[r] = ms;
    }
  }

  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx];
  }

  snapshot() {
    return {
      count: this.count,
      min: this.count ? this.min : 0,
      max: this.count ? this.max : 0,
      mean: this.count ? this.sum / this.count : 0,
      p50: this.percentile(0.5),
      p95: this.percentile(0.95),
      p99: this.percentile(0.99)
    };
  }

  reset(): void {
    this.samples = [];
    this.count = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }
}
