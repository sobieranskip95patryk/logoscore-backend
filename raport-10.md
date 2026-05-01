# RAPORT-10 — Sprint X · Globalna Synapsa Ekonomiczna

> *Fenrirze, zamknięto Sprint X. Ekonomizer wyrósł z lokalnej kapliczki w katedrę o trzech nawach. Pojedyncza instancja MTAQuestWebsideX przemówiła językiem rojów: jedna dusza w wielu ciałach, jedna pamięć w wielu rdzeniach.*

---

## I. Wchłonięte parametry

- **Dyrektywa:** *„Konsolidacja ekonomizera... Batch Embed oraz synchronizację L1 z Redisem (Memorystore). Budowa globalnej pamięci podręcznej wyeliminuje ostatnie enklawy nieefektywności."*
- **Stan wejściowy:** Sprint IX zamknięty (67 passed, ekonomizer L0 LRU + L2 Mongo, semantic dedup pgvector).
- **Cel ostateczny:** cross-instance cache coherence i 1-call-per-N tekstów embed dla `Cloud Run min-instances > 1`.

---

## II. Architektura batch — Gemini batchEmbedContents + uniwersalny fallback

Dodano kontrakt:

```ts
// src/infrastructure/ai/provider.types.ts
export interface EmbedBatchInput  { texts: string[]; model?: string; dimensions?: number; }
export interface EmbedBatchOutput { vectors: number[][]; dimensions: number; provider: string; model: string; }
interface LLMProvider {
  embedBatch?(input: EmbedBatchInput): Promise<EmbedBatchOutput>;
}
```

Implementacje:
- **GeminiProvider** — natywny REST `:batchEmbedContents` (1 HTTP/N tekstów, weryfikacja długości).
- **SimulatedProvider** — `Promise.all(map(embed))` (deterministyczne, dla testów).
- **OllamaProvider** — pozostawiony bez batch; `ExecuteService.callBatchEmbed` wykrywa brak metody i automatycznie spada do `Promise.all`.

`ExecuteService.embedBatch()`:
- Cięcie chunkowe na `economizer.batchMaxSize` (domyślnie 100 — limit Gemini).
- Flaga `economizer.batchEnabled=false` → bypass do per-text cached embedów.

---

## III. Trzywarstwowy cache — L0 LRU / L1 Redis / L2 Mongo

Dodano `src/infrastructure/ai/economizer/redis-cache.layer.ts` — adapter ioredis z prefiksem `eco:embed:` / `eco:synth:`, JSON serializacja, TTL `economizer.redisCacheTtlSeconds` (24h domyślnie — krótsze niż 30-dniowy Mongo, bo Redis to *gorąca pamięć*, nie archiwum).

Hierarchia dostępu w `wrapEmbed` / `wrapSynthesize` / `wrapEmbedBatch`:

| Warstwa | Latencja | Zasięg | TTL | Rola |
|---|---|---|---|---|
| L0 LRU in-mem | μs | per-instance | LRU eviction | Hot path |
| L1 Redis (Memorystore) | ~1 ms | cross-instance | 24h | Synchronizacja rojów |
| L2 Mongo | ~15 ms | global, trwały | 30d | Survives deploy |

Write-back: hit w L1 hydratuje L0; hit w L2 hydratuje L0 + L1 (fire-and-forget). Brak Redis = enabled()=false, wszystkie operacje no-op (graceful, jak w Sprincie IX dla Mongo).

### `wrapEmbedBatch` — batch z dedup-aware lookupem

Algorytm:
1. Dla każdego tekstu: `lookupEmbed(key)` (L0 → L1 → L2).
2. Zbierz `(index, text)` miss-ów.
3. **Jeden** call `raw({texts: missTexts})`.
4. Wpisz każdy nowy wektor do L0 + L1 + L2.
5. Zwróć vectors w kolejności wejściowej.

**Korzyść:** 50 chunków, 40 to powtórki → 1 batch HTTP z 10 textami zamiast 50 sekwencyjnych embedów. Najczęstszy kontekst: ingest dokumentu na sesji, gdzie znaczna część fragmentów już była indeksowana w innych sesjach.

---

## IV. Rate-limit Redis store — wykonanie zapowiedzi z Sprintu VIII

W `src/shared/middleware/rate-limit.middleware.ts` (komentarz Sprintu VIII głosił: *„dla Cloud Run min-instances>1 podłącz Redis store"* — TUTAJ wykonano):

```ts
const store = appConfig.redis.rateLimitStore ? buildRedisStore(prefix) : undefined;
```

`buildRedisStore` używa `require('rate-limit-redis')` (lazy, paczka opcjonalna) z `sendCommand: (...args) => redis.call(...args)`. Brak Redis = `undefined` = fallback do default memory store (single-instance pozostaje funkcjonalny). Prefix per-limiter (`global` / `ai`) zapobiega kolizjom.

**Synergia z VIII:** wszystkie istniejące testy `rate-limit.test.ts` pozostają zielone bez zmian (graceful degradation: brak `REDIS_URL` w test env → memory store identyczny jak przed Sprintem X).

---

## V. Refaktor `embeddingRepository.ingestMany`

Z:
```ts
for (const c of chunks) out.push(await this.ingest(sessionId, c, metadata));  // O(N) HTTP
```

Na:
```ts
const { vectors } = await executeService.embedBatch({ texts: chunks });        // 1 HTTP
for (let i = 0; i < chunks.length; i++) {
  const dup = await this.findNearDuplicate(sessionId, vectors[i], threshold);
  if (dup) { economizerMetrics.recordEmbedDedupHit(text); out.push(dup); continue; }
  // bulk insert do pgvector / fallback in-mem
}
```

Dedup nadal działa per-chunk po lookupie — tylko etap embedowania jest sbatch-owany.

---

## VI. Lekcje

1. **Redis lazy require**: paczka `rate-limit-redis` jest opcjonalna w środowiskach lokalnych — `require()` w funkcji + try/catch + flaga warn-once eliminuje twardą zależność.
2. **Batch length contract**: zawsze weryfikuj `provider.vectors.length === input.texts.length` przed indeksowanym przepisaniem do slotów — Gemini zwraca tablicę dokładnie tej samej długości, ale na błędach tablica `embeddings` może być pusta lub `undefined`.
3. **Write-back hydration**: hit w L2 musi hydratować L1 (i L0), inaczej kolejna instancja będzie ciągle uderzać do Mongo. Fire-and-forget `.catch(()=>{})` na L1 chroni hot path.
4. **`provider:'cache'` jako sygnał**: gdy 100% batch hit w cache, zwracamy `provider:'cache'` (nie nazwa providera). Pozwala obserwować rozkład cache-vs-real bez dodatkowego kanału.
5. **TTL hierarchia**: krótsze TTL na wyższej warstwie (Redis 24h < Mongo 30d). Eviction Redisa nie unieważnia danych — automatycznie wracają z L2 przy następnym lookupie.

---

## VII. Delta plików

**Nowe:**
- `src/infrastructure/ai/economizer/redis-cache.layer.ts` (60 linii)
- `tests/unit/economizer-batch.test.ts` (5 testów)
- `tests/unit/economizer-redis-cache.test.ts` (2 testy)
- `tests/integration/batch-embed-dedup.test.ts` (2 testy)

**Zmienione:**
- `src/infrastructure/ai/provider.types.ts` — `EmbedBatchInput/Output`, `embedBatch?` w `LLMProvider`
- `src/infrastructure/ai/providers/gemini.provider.ts` — metoda `embedBatch` (REST `batchEmbedContents`)
- `src/infrastructure/ai/providers/simulated.provider.ts` — metoda `embedBatch` (loop)
- `src/infrastructure/ai/economizer/index.ts` — `wrapEmbedBatch`, integracja Redis L1, refaktor `wrapEmbed`/`wrapSynthesize` na trzywarstwową hierarchię
- `src/infrastructure/ai/execute.service.ts` — `embedBatch()`, `cachedEmbedBatch`, `callBatchEmbed`, `fallbackBatch`, chunking po `batchMaxSize`
- `src/modules/memory/infrastructure/embedding.repository.ts` — `ingestMany` na batch path
- `src/shared/middleware/rate-limit.middleware.ts` — Redis store z lazy require + fallback
- `src/core/config/app.config.ts` — `redis.rateLimitStore`, `economizer.{batchEnabled, batchMaxSize, redisCacheEnabled, redisCacheTtlSeconds}`

**Dependencies:** +1 `rate-limit-redis@4`.

---

## VIII. Weryfikacja B=1.0

| Etap | Wynik |
|---|---|
| `npx tsc --noEmit` | EXIT=0 (czyste typy) |
| `npx jest --colors=false` | **76 passed / 1 skipped / 0 failed** (16/17 suites; +9 vs Sprint IX) |
| `npx tsc -p tsconfig.json` | EXIT=0 (build do `dist/`) |

Wzrost pokrycia: 67 → 76 testów (+13.4%).

---

## IX. Otwarte fronty

1. **Memorystore provisioning na GCP** — kod gotowy, brakuje Terraform/gcloud manifestu na faktyczną instancję Redis (basic tier wystarczy do MVP).
2. **Metryki Redis hit-rate** — obecnie `economizerMetrics` traktuje L0/L1/L2 jako jeden `cacheHits`. Rozsądnie byłoby rozdzielić counter na warstwy dla obserwowalności kosztu Memorystore.
3. **TTL refresh strategy** — przy hit w L2 ustawiamy nowy klucz w L1 z pełnym TTL (24h), ale nie odświeżamy `expiresAt` w L2. Gorące dane mogą wygasnąć w Mongo przy ciągłych hitach z L1. Do rozważenia: leniwe `updateOne({key}, {$set:{expiresAt:...}})` co N hit.
4. **`embedBatch` semantic dedup wewnątrz batcha** — obecnie dedup szuka tylko w bazie, nie pomiędzy chunkami tego samego batcha. Dwa identyczne chunki w jednym `ingestMany` przejdą jako dwa fragmenty (cache klucz ich zlewa, ale insert idzie dwa razy).
5. **Postgres connection pool sizing** — przy batch ingest 100 chunków robimy 100 INSERT-ów (lub 100 SELECT dedup + N INSERT). Bulk INSERT w jednym query to naturalny dalszy krok.

---

## X. Trzy ścieżki dalej

### Ścieżka 1 — **Sprint XI: Observability Mesh** (rekomendowana)
- OpenTelemetry traces/metrics/logs (OTLP → Cloud Trace + Cloud Monitoring).
- Rozdzielone countery cache hit per warstwa (L0/L1/L2).
- Health-check endpoint z deep-probe Redis/Mongo/Postgres.
- Dashboard SLO: p50/p95/p99 latencji embed/synth/analyze + cache hit rate.
- *Uzasadnienie:* po IX+X mamy trzy warstwy cache i rozproszony rate-limit — bez observability diagnostyka anomalii w produkcji jest ślepa.

### Ścieżka 2 — **Sprint XI: Cloud Run Deployment Hardening**
- Dockerfile multi-stage, distroless runtime image.
- Cloud Build pipeline z `gcloud run deploy` + Workload Identity Federation.
- Sekrety przez Secret Manager (Firebase service account, Gemini API key).
- VPC connector → Memorystore + Cloud SQL bez publicznych IP.
- *Uzasadnienie:* kod jest gotowy na multi-instance, infrastruktura jeszcze nie.

### Ścieżka 3 — **Sprint XI: Quest Engine Expansion**
- Wielopoziomowe questy (parent/child + dependencies).
- Reward system z punktami i odznakami.
- Quest templates + scheduler.
- *Uzasadnienie:* IX i X to fortyfikacja wewnętrzna; ścieżka 3 to nowa wartość użytkowa.

---

*Czekam na wskazanie ścieżki, Wilku Północy.*
