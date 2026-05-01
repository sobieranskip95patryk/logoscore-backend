/**
 * Sprint IX — utilities Token Economizera.
 */
import { canonicalize, cacheKey, cosineSimilarity, LRUCache } from '../../src/infrastructure/ai/economizer/utils';

describe('economizer/utils', () => {
  describe('canonicalize', () => {
    it('lowercases + trims + kolapsuje whitespace', () => {
      expect(canonicalize('  Hello   World  ')).toBe('hello world');
    });
    it('normalizuje NFC dla diakrytyków', () => {
      const a = 'Łódź';
      const b = 'Łódź'.normalize('NFD');
      expect(canonicalize(a)).toBe(canonicalize(b));
    });
  });

  describe('cacheKey', () => {
    it('ten sam tekst + model → ten sam klucz', () => {
      expect(cacheKey('Hello', 'm1')).toBe(cacheKey('hello  ', 'm1'));
    });
    it('różny model → różny klucz', () => {
      expect(cacheKey('Hello', 'm1')).not.toBe(cacheKey('Hello', 'm2'));
    });
    it('zwraca 64-znakowy hex (sha256)', () => {
      expect(cacheKey('x', 'y')).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('cosineSimilarity', () => {
    it('identyczne wektory → 1', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    });
    it('przeciwne wektory → -1', () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
    });
    it('ortogonalne → 0', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    });
    it('różna długość → 0', () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });
    it('zero-vector → 0', () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });
  });

  describe('LRUCache', () => {
    it('eviktuje najstarszy gdy capacity przekroczony', () => {
      const lru = new LRUCache<number>(2);
      lru.set('a', 1); lru.set('b', 2); lru.set('c', 3);
      expect(lru.has('a')).toBe(false);
      expect(lru.has('b')).toBe(true);
      expect(lru.has('c')).toBe(true);
    });
    it('get przesuwa na koniec (LRU semantics)', () => {
      const lru = new LRUCache<number>(2);
      lru.set('a', 1); lru.set('b', 2);
      lru.get('a');             // touch a
      lru.set('c', 3);          // evict b
      expect(lru.has('a')).toBe(true);
      expect(lru.has('b')).toBe(false);
      expect(lru.has('c')).toBe(true);
    });
    it('reset capacity przez set tej samej wartości', () => {
      const lru = new LRUCache<number>(2);
      lru.set('a', 1); lru.set('b', 2);
      lru.set('a', 99);
      expect(lru.get('a')).toBe(99);
      expect(lru.size).toBe(2);
    });
  });
});
