/**
 * Sprint IX — utilities Token Economizera.
 * Bez zewnętrznych zależności (lru-cache nie jest w deps).
 */
import { createHash } from 'crypto';

/**
 * Kanonikalizuje tekst do klucza cache:
 * - lowercase
 * - trim
 * - kolapsuje sekwencje białych znaków do pojedynczej spacji
 */
export function canonicalize(text: string): string {
  return text.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Hash sha256 dla pary (text, model). Stała długość = 64 znaki hex. */
export function cacheKey(text: string, model: string): string {
  return createHash('sha256').update(`${model}::${canonicalize(text)}`).digest('hex');
}

/** Cosine similarity dla wektorów równej długości. Brak normalizacji wymagany. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Lekki LRU cache (Map preserves insertion order — usuń+wstaw = przesunięcie na koniec).
 * Brak TTL in-mem (mongo TTL załatwia trwałość); pojemność ograniczona.
 */
export class LRUCache<V> {
  private map = new Map<string, V>();
  constructor(private capacity: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // touch — przesuń na koniec
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  has(key: string): boolean { return this.map.has(key); }
  get size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
}
