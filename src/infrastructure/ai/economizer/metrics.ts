/**
 * Sprint IX/XI — Token Economizer metrics.
 * Lekkie in-process counters + Sprint XI per-warstwę cache layer counters
 * + latency histogramy (p50/p95/p99) per AI op + per cache layer.
 * Eksportowane przez /api/admin/economizer/metrics.
 */
import { LatencyHistogram } from '../../observability/latency-histogram';

export type CacheLayer = 'l0' | 'l1' | 'l2';

export interface EconomizerSnapshot {
  embed: {
    requests: number;
    cacheHits: number;
    dedupHits: number;
    misses: number;
    tokensSaved: number;
    cacheHitRate: number;
    dedupHitRate: number;
    avgSavedPerHit: number;
    /** Sprint XI: rozdzielenie hitów per warstwa. */
    layerHits: Record<CacheLayer, number>;
    layerHitRates: Record<CacheLayer, number>;
  };
  synth: {
    requests: number;
    cacheHits: number;
    misses: number;
    charsSaved: number;
    cacheHitRate: number;
    layerHits: Record<CacheLayer, number>;
    layerHitRates: Record<CacheLayer, number>;
  };
  /** Sprint XI: latency histogramy per operacja AI + per warstwa cache. */
  latency: {
    embedTotalMs:    ReturnType<LatencyHistogram['snapshot']>;
    synthTotalMs:    ReturnType<LatencyHistogram['snapshot']>;
    analyzeMs:       ReturnType<LatencyHistogram['snapshot']>;
    embedBatchMs:    ReturnType<LatencyHistogram['snapshot']>;
    cacheLookupMs:   Record<CacheLayer, ReturnType<LatencyHistogram['snapshot']>>;
    providerEmbedMs: ReturnType<LatencyHistogram['snapshot']>;
    providerSynthMs: ReturnType<LatencyHistogram['snapshot']>;
  };
  uptimeSeconds: number;
  startedAt: string;
}

class EconomizerMetrics {
  private startedAt = Date.now();
  embed = {
    requests: 0, cacheHits: 0, dedupHits: 0, misses: 0, tokensSaved: 0,
    layerHits: { l0: 0, l1: 0, l2: 0 } as Record<CacheLayer, number>
  };
  synth = {
    requests: 0, cacheHits: 0, misses: 0, charsSaved: 0,
    layerHits: { l0: 0, l1: 0, l2: 0 } as Record<CacheLayer, number>
  };

  histEmbedTotal    = new LatencyHistogram();
  histSynthTotal    = new LatencyHistogram();
  histAnalyze       = new LatencyHistogram();
  histEmbedBatch    = new LatencyHistogram();
  histCacheLookup: Record<CacheLayer, LatencyHistogram> = {
    l0: new LatencyHistogram(),
    l1: new LatencyHistogram(),
    l2: new LatencyHistogram()
  };
  histProviderEmbed = new LatencyHistogram();
  histProviderSynth = new LatencyHistogram();

  recordEmbedRequest(): void { this.embed.requests++; }
  recordEmbedCacheHit(text: string, layer: CacheLayer = 'l0'): void {
    this.embed.cacheHits++;
    this.embed.layerHits[layer]++;
    this.embed.tokensSaved += this.estimateTokens(text);
  }
  recordEmbedDedupHit(text: string): void {
    this.embed.dedupHits++;
    this.embed.tokensSaved += this.estimateTokens(text);
  }
  recordEmbedMiss(): void { this.embed.misses++; }

  recordSynthRequest(): void { this.synth.requests++; }
  recordSynthCacheHit(text: string, layer: CacheLayer = 'l0'): void {
    this.synth.cacheHits++;
    this.synth.layerHits[layer]++;
    this.synth.charsSaved += text.length;
  }
  recordSynthMiss(): void { this.synth.misses++; }

  observeEmbedTotal(ms: number):    void { this.histEmbedTotal.observe(ms); }
  observeSynthTotal(ms: number):    void { this.histSynthTotal.observe(ms); }
  observeAnalyze(ms: number):       void { this.histAnalyze.observe(ms); }
  observeEmbedBatch(ms: number):    void { this.histEmbedBatch.observe(ms); }
  observeCacheLookup(layer: CacheLayer, ms: number): void { this.histCacheLookup[layer].observe(ms); }
  observeProviderEmbed(ms: number): void { this.histProviderEmbed.observe(ms); }
  observeProviderSynth(ms: number): void { this.histProviderSynth.observe(ms); }

  reset(): void {
    this.embed = {
      requests: 0, cacheHits: 0, dedupHits: 0, misses: 0, tokensSaved: 0,
      layerHits: { l0: 0, l1: 0, l2: 0 }
    };
    this.synth = {
      requests: 0, cacheHits: 0, misses: 0, charsSaved: 0,
      layerHits: { l0: 0, l1: 0, l2: 0 }
    };
    this.histEmbedTotal.reset();
    this.histSynthTotal.reset();
    this.histAnalyze.reset();
    this.histEmbedBatch.reset();
    this.histCacheLookup.l0.reset();
    this.histCacheLookup.l1.reset();
    this.histCacheLookup.l2.reset();
    this.histProviderEmbed.reset();
    this.histProviderSynth.reset();
    this.startedAt = Date.now();
  }

  snapshot(): EconomizerSnapshot {
    const eHits = this.embed.cacheHits + this.embed.dedupHits;
    const totalEmbedHits = this.embed.layerHits.l0 + this.embed.layerHits.l1 + this.embed.layerHits.l2 || 1;
    const totalSynthHits = this.synth.layerHits.l0 + this.synth.layerHits.l1 + this.synth.layerHits.l2 || 1;
    return {
      embed: {
        ...this.embed,
        cacheHitRate: this.embed.requests ? this.embed.cacheHits / this.embed.requests : 0,
        dedupHitRate: this.embed.requests ? this.embed.dedupHits / this.embed.requests : 0,
        avgSavedPerHit: eHits ? this.embed.tokensSaved / eHits : 0,
        layerHitRates: {
          l0: this.embed.layerHits.l0 / totalEmbedHits,
          l1: this.embed.layerHits.l1 / totalEmbedHits,
          l2: this.embed.layerHits.l2 / totalEmbedHits
        }
      },
      synth: {
        ...this.synth,
        cacheHitRate: this.synth.requests ? this.synth.cacheHits / this.synth.requests : 0,
        layerHitRates: {
          l0: this.synth.layerHits.l0 / totalSynthHits,
          l1: this.synth.layerHits.l1 / totalSynthHits,
          l2: this.synth.layerHits.l2 / totalSynthHits
        }
      },
      latency: {
        embedTotalMs: this.histEmbedTotal.snapshot(),
        synthTotalMs: this.histSynthTotal.snapshot(),
        analyzeMs:    this.histAnalyze.snapshot(),
        embedBatchMs: this.histEmbedBatch.snapshot(),
        cacheLookupMs: {
          l0: this.histCacheLookup.l0.snapshot(),
          l1: this.histCacheLookup.l1.snapshot(),
          l2: this.histCacheLookup.l2.snapshot()
        },
        providerEmbedMs: this.histProviderEmbed.snapshot(),
        providerSynthMs: this.histProviderSynth.snapshot()
      },
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      startedAt: new Date(this.startedAt).toISOString()
    };
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export const economizerMetrics = new EconomizerMetrics();
