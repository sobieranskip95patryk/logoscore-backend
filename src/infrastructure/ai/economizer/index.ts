/**
 * Sprint IX/X — Token Economizer.
 *
 * Decorator dla `ExecuteService` który:
 *  1. Embeddingi: in-mem LRU + Redis L1 + Mongo persistent cache
 *     (klucz = sha256(model::canonicalize(text)))
 *  2. Syntezy:    analogicznie (klucz = sha256(voice::canonicalize(text)))
 *  3. Batch embed (Sprint X): rozdziela hits/misses, jednym wywołaniem
 *     dobiera tylko brakujące, uzupełnia wszystkie warstwy cache
 *  4. Metrics: requesty / cache hits / dedup hits / tokens saved
 *
 * Nie cache'uje `analyze()` — wynik zależy od dynamicznego kontekstu.
 *
 * Hierarchia cache (od najszybszego):
 *   L0 LRU in-mem  — mikrosekundy, per-instance
 *   L1 Redis       — pojedyncze ms, cross-instance (Memorystore)
 *   L2 Mongo       — kilkanaście ms, trwały (przeżyje deploy)
 */
import {
  EmbedInput, EmbedOutput, EmbedBatchInput, EmbedBatchOutput,
  SynthesizeInput, SynthesizeOutput
} from '../provider.types';
import { appConfig } from '../../../core/config/app.config';
import { LRUCache, cacheKey } from './utils';
import { economizerMetrics } from './metrics';
import { aiCacheRepository } from './ai-cache.repository';
import { redisCacheLayer } from './redis-cache.layer';

type EmbedFn = (input: EmbedInput) => Promise<EmbedOutput>;
type EmbedBatchFn = (input: EmbedBatchInput) => Promise<EmbedBatchOutput>;
type SynthFn = (input: SynthesizeInput) => Promise<SynthesizeOutput>;

const embedLRU = new LRUCache<EmbedOutput>(appConfig.economizer.embedCacheSize);
const synthLRU = new LRUCache<SynthesizeOutput>(appConfig.economizer.synthCacheSize);

/**
 * Lookup we wszystkich warstwach cache (LRU → Redis → Mongo). Hit hydratuje
 * wyższe warstwy (write-back). Miss zwraca null bez side-effectów.
 *
 * Sprint XI: zwraca też `layer` która trafiła + observuje latency per warstwa.
 */
async function lookupEmbed(key: string): Promise<{ value: EmbedOutput; layer: 'l0' | 'l1' | 'l2' } | null> {
  const t0 = Date.now();
  const l0 = embedLRU.get(key);
  economizerMetrics.observeCacheLookup('l0', Date.now() - t0);
  if (l0) return { value: l0, layer: 'l0' };

  const t1 = Date.now();
  const l1 = await redisCacheLayer.get<EmbedOutput>('embed', key);
  economizerMetrics.observeCacheLookup('l1', Date.now() - t1);
  if (l1) {
    embedLRU.set(key, l1);
    return { value: l1, layer: 'l1' };
  }

  const t2 = Date.now();
  const l2 = await aiCacheRepository.get<EmbedOutput>(key);
  economizerMetrics.observeCacheLookup('l2', Date.now() - t2);
  if (l2) {
    embedLRU.set(key, l2.payload);
    redisCacheLayer.put('embed', key, l2.payload).catch(() => {});
    return { value: l2.payload, layer: 'l2' };
  }
  return null;
}

function persistEmbed(key: string, model: string, text: string, payload: EmbedOutput): void {
  embedLRU.set(key, payload);
  redisCacheLayer.put('embed', key, payload).catch(() => {});
  aiCacheRepository.put(key, 'embed', model, text, payload).catch(() => {});
}

/**
 * Owija raw embed → cached embed (3 warstwy + miss).
 */
export function wrapEmbed(raw: EmbedFn): EmbedFn {
  if (!appConfig.economizer.enabled) return raw;

  return async (input: EmbedInput): Promise<EmbedOutput> => {
    const tStart = Date.now();
    economizerMetrics.recordEmbedRequest();
    const model = input.model || appConfig.ai.modelEmbed;
    const key = cacheKey(input.text, model);

    const hit = await lookupEmbed(key);
    if (hit) {
      economizerMetrics.recordEmbedCacheHit(input.text, hit.layer);
      economizerMetrics.observeEmbedTotal(Date.now() - tStart);
      return hit.value;
    }

    economizerMetrics.recordEmbedMiss();
    const tProvider = Date.now();
    const out = await raw(input);
    economizerMetrics.observeProviderEmbed(Date.now() - tProvider);
    persistEmbed(key, model, input.text, out);
    economizerMetrics.observeEmbedTotal(Date.now() - tStart);
    return out;
  };
}

/**
 * Sprint X: batch embed z deduplikacją cache.
 *
 * Algorytm:
 *  1. Dla każdego tekstu: sprawdź wszystkie warstwy cache.
 *  2. Zbuduj listę (index, text) miss-ów.
 *  3. Jeden batch-call do providera dla miss-ów.
 *  4. Zapisz każdy miss do wszystkich warstw cache.
 *  5. Zwróć wektory w kolejności wejściowej.
 *
 * Korzyść: gdy 90% textów to powtórki — robimy 1 mały batch zamiast 0 + 100 cache hitów.
 */
export function wrapEmbedBatch(raw: EmbedBatchFn): EmbedBatchFn {
  if (!appConfig.economizer.enabled) return raw;

  return async (input: EmbedBatchInput): Promise<EmbedBatchOutput> => {
    const tStart = Date.now();
    if (input.texts.length === 0) {
      economizerMetrics.observeEmbedBatch(Date.now() - tStart);
      return { vectors: [], dimensions: 0, provider: 'cache', model: input.model || appConfig.ai.modelEmbed };
    }

    const model = input.model || appConfig.ai.modelEmbed;
    const keys = input.texts.map(t => cacheKey(t, model));

    // L0/L1/L2 lookup równolegle.
    const cached = await Promise.all(keys.map(k => lookupEmbed(k)));

    const vectors: number[][] = new Array(input.texts.length);
    const missIndices: number[] = [];
    const missTexts: string[] = [];

    for (let i = 0; i < input.texts.length; i++) {
      economizerMetrics.recordEmbedRequest();
      const c = cached[i];
      if (c) {
        vectors[i] = c.value.vector;
        economizerMetrics.recordEmbedCacheHit(input.texts[i], c.layer);
      } else {
        missIndices.push(i);
        missTexts.push(input.texts[i]);
      }
    }

    if (missTexts.length === 0) {
      const dims = vectors[0]?.length ?? 0;
      economizerMetrics.observeEmbedBatch(Date.now() - tStart);
      return { vectors, dimensions: dims, provider: 'cache', model };
    }

    missIndices.forEach(() => economizerMetrics.recordEmbedMiss());
    const tProvider = Date.now();
    const out = await raw({ texts: missTexts, model: input.model, dimensions: input.dimensions });
    economizerMetrics.observeProviderEmbed(Date.now() - tProvider);

    if (out.vectors.length !== missTexts.length) {
      throw new Error(`[economizer] batch length mismatch: provider returned ${out.vectors.length}, expected ${missTexts.length}`);
    }

    for (let i = 0; i < missIndices.length; i++) {
      const idx = missIndices[i];
      const vec = out.vectors[i];
      const text = missTexts[i];
      vectors[idx] = vec;
      const single: EmbedOutput = {
        vector: vec, dimensions: out.dimensions, provider: out.provider, model: out.model
      };
      persistEmbed(keys[idx], out.model, text, single);
    }

    economizerMetrics.observeEmbedBatch(Date.now() - tStart);
    return {
      vectors,
      dimensions: out.dimensions,
      provider: out.provider,
      model: out.model
    };
  };
}

export function wrapSynthesize(raw: SynthFn): SynthFn {
  if (!appConfig.economizer.enabled) return raw;

  return async (input: SynthesizeInput): Promise<SynthesizeOutput> => {
    const tStart = Date.now();
    economizerMetrics.recordSynthRequest();

    const voice = input.voiceName || 'default';
    const modelTag = `tts::${voice}`;
    const key = cacheKey(input.text, modelTag);

    const t0 = Date.now();
    const l0 = synthLRU.get(key);
    economizerMetrics.observeCacheLookup('l0', Date.now() - t0);
    if (l0) {
      economizerMetrics.recordSynthCacheHit(input.text, 'l0');
      economizerMetrics.observeSynthTotal(Date.now() - tStart);
      return l0;
    }

    const t1 = Date.now();
    const l1 = await redisCacheLayer.get<SynthesizeOutput>('synth', key);
    economizerMetrics.observeCacheLookup('l1', Date.now() - t1);
    if (l1) {
      synthLRU.set(key, l1);
      economizerMetrics.recordSynthCacheHit(input.text, 'l1');
      economizerMetrics.observeSynthTotal(Date.now() - tStart);
      return l1;
    }

    const t2 = Date.now();
    const l2 = await aiCacheRepository.get<SynthesizeOutput>(key);
    economizerMetrics.observeCacheLookup('l2', Date.now() - t2);
    if (l2) {
      synthLRU.set(key, l2.payload);
      redisCacheLayer.put('synth', key, l2.payload).catch(() => {});
      economizerMetrics.recordSynthCacheHit(input.text, 'l2');
      economizerMetrics.observeSynthTotal(Date.now() - tStart);
      return l2.payload;
    }

    economizerMetrics.recordSynthMiss();
    const tProvider = Date.now();
    const out = await raw(input);
    economizerMetrics.observeProviderSynth(Date.now() - tProvider);
    synthLRU.set(key, out);
    redisCacheLayer.put('synth', key, out).catch(() => {});
    aiCacheRepository.put(key, 'synth', modelTag, input.text, out).catch(() => {});
    economizerMetrics.observeSynthTotal(Date.now() - tStart);
    return out;
  };
}

/** Test/diagnostyka: wymuś czyszczenie LRU. Redis i Mongo TTL załatwiają persistent layery. */
export function __clearEconomizerCaches(): void {
  embedLRU.clear();
  synthLRU.clear();
}

/** Diagnostyka: rozmiary LRU dla /admin/economizer/metrics. */
export function lruSizes(): { embed: number; synth: number; redisEnabled: boolean } {
  return { embed: embedLRU.size, synth: synthLRU.size, redisEnabled: redisCacheLayer.enabled() };
}
