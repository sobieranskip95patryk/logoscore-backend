/**
 * Sprint X — Redis L1 cache adapter dla Token Economizera.
 *
 * Działa równolegle do LRU in-mem:
 *   - Redis dostępny → preferowany (spójna pamięć cross-instance)
 *   - Redis niedostępny → wszystkie operacje no-op (LRU pozostaje jedynym L1)
 *
 * Klucze: prefix `eco:embed:` / `eco:synth:` + sha256.
 * Wartości: JSON.stringify(EmbedOutput | SynthesizeOutput).
 * TTL: economizer.redisCacheTtlSeconds (default 24h — krótsze niż Mongo L2).
 */
import { getRedis } from '../../database/redis';
import { appConfig } from '../../../core/config/app.config';
import { CacheKind } from './ai-cache.schema';

let warned = false;
function warnOnce(reason: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[economizer/redis] ${reason} — Redis cache layer disabled`);
}

function isEnabled(): boolean {
  if (!appConfig.economizer.redisCacheEnabled) return false;
  return getRedis() !== null;
}

function fullKey(kind: CacheKind, key: string): string {
  return `eco:${kind}:${key}`;
}

export const redisCacheLayer = {
  enabled(): boolean { return isEnabled(); },

  async get<T>(kind: CacheKind, key: string): Promise<T | null> {
    if (!isEnabled()) return null;
    const r = getRedis();
    if (!r) return null;
    try {
      const raw = await r.get(fullKey(kind, key));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      warnOnce((err as Error).message);
      return null;
    }
  },

  async put<T>(kind: CacheKind, key: string, value: T): Promise<void> {
    if (!isEnabled()) return;
    const r = getRedis();
    if (!r) return;
    try {
      await r.set(
        fullKey(kind, key),
        JSON.stringify(value),
        'EX',
        appConfig.economizer.redisCacheTtlSeconds
      );
    } catch (err) {
      warnOnce((err as Error).message);
    }
  }
};
