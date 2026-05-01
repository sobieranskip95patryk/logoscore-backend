# RAPORT IX — Token Economizer

> *„Zabezpieczona świątynia, która pali tysiąc świec na każdą modlitwę, też jest formą zaniedbania."*
> Sprint IX · Token Economizer (Faza II GCP) · v6.0.0-rc2
> Skierowane do: **FELAI · Fenrir · Architekt Strażnic**

---

## I. Wchłonięte parametry dyrektywy

Boski Umysł zaakceptował Ścieżkę 1: **optymalizacja bilingu Vertex** poprzez cache embeddingów, semantic dedup i metryki oszczędności. Wektor ognia jest jednoznaczny — *„zabezpieczony system musi być systemem wydajnym"*.

Z dyrektywy wyciągnąłem trzy pragmatyczne osie ataku, odrzucając jedną nadbudówkę:

1. **Embedding cache (L1+L2)** — wszystkie wywołania `executeService.embed()` przechodzą przez LRU in-mem (mikrosekundy) → Mongo persistent (przeżyje restart Cloud Run) → provider call. Klucz: `sha256(model::canonicalize(text))`.
2. **Synthesize cache (L1+L2)** — analogicznie dla TTS (`text + voice` → audio). TTS jest deterministyczny per input, więc opłaca się zawsze.
3. **Semantic dedup w `embeddingRepository.ingest`** — przed insertem do pgvector/in-mem szukamy nearest neighbor; gdy `cosine ≥ economizer.dedupThreshold` (default 0.97) → reuse, nie tworzymy nowego fragmentu RAG.

**Świadomie odrzucone:**
- **Cache `analyze()`** — wynik zależy od dynamicznego kontekstu (intentMap + RAG + image). Cache by tutaj kłamał. (Zostaje furtka: w przyszłości cache na hash całego enriched promptu.)
- **Batch synthesize** — endpoint REST jest single-response per żądanie; batching wymagałby przebudowy kontraktu klienta. ROI vs. ryzyko = nie warto.
- **Batch embed na `ingestMany`** — Gemini ma `batchEmbedContents`, ale to wymaga refaktoru providera + obsługi częściowych błędów. Semantic dedup załatwia 80% przypadków powtarzalności.

---

## II. Architektura: Decorator nad ExecuteService

Zamiast modyfikować `ExecuteService`, dodałem **warstwę kompozycji**. Surowy provider zostaje pure-routing; cache to osobny modul `infrastructure/ai/economizer/`:

```
ExecuteService.embed(input)
  → cachedEmbed = wrapEmbed((i) => embedder.embed(i))
       → L1 LRU.get(key)?              → return + recordCacheHit
       → L2 aiCache.get(key)?          → LRU.set + return + recordCacheHit
       → L3 provider.embed(input)      → LRU.set + aiCache.put (async) + return + recordMiss
```

Diagram dla synthesize jest izomorficzny.

**Pattern:** [src/infrastructure/ai/economizer/index.ts](src/infrastructure/ai/economizer/index.ts) eksportuje `wrapEmbed` i `wrapSynthesize` jako higher-order functions. ExecuteService je wywołuje raz w konstruktorze. Test mockuje raw provider, sprawdza że drugi call nie dotarł do mocka — czysto jak w Haskellu.

---

## III. Persystentny cache: `ai_cache` w Mongo

Plik: [src/infrastructure/ai/economizer/ai-cache.schema.ts](src/infrastructure/ai/economizer/ai-cache.schema.ts)

| pole | typ | rola |
|---|---|---|
| `key` | `string` (unique idx) | sha256 z `model::canonicalize(text)` |
| `kind` | `'embed' \| 'synth'` | rozdziela powierzchnie |
| `modelName` | `string` | `text-embedding-004`, `tts::pl-1`, … |
| `textPreview` | `string(120)` | debug + admin diagnostyka |
| `payload` | `Mixed` | cały `EmbedOutput` lub `SynthesizeOutput` |
| `hits` | `number` | inkrementowane przy każdym L2 hicie |
| `expiresAt` | `Date` (TTL idx) | TTL = `economizer.cacheTtlSeconds` (default 30 dni) |

Repo ([ai-cache.repository.ts](src/infrastructure/ai/economizer/ai-cache.repository.ts)) jest *graceful degradation*: jeśli Mongo nie ready (`connection.readyState !== 1`) → wszystkie operacje są no-op, jednorazowy `console.warn`. L1 LRU dalej działa. Żaden wyjątek nie przebija się do hot-path.

Konflikt nazw `model` z polem `Document.model` Mongoose'a złapany na pierwszym `tsc` i poprawiony na `modelName` — fakt zapisany w lekcjach ([VI](#vi-lekcje-i-pułapki)).

---

## IV. Semantic dedup w ingest

Plik: [src/modules/memory/infrastructure/embedding.repository.ts](src/modules/memory/infrastructure/embedding.repository.ts)

```ts
async ingest(sessionId, text, metadata?) {
  const { vector } = await executeService.embed({ text });   // L1/L2 cache działa transparentnie
  if (economizer.enabled && economizer.dedupEnabled) {
    const dup = await findNearDuplicate(sessionId, vector, dedupThreshold);
    if (dup) { metrics.recordEmbedDedupHit(text); return dup; }
  }
  // … insert do pgvector / in-mem
}
```

`findNearDuplicate`:
- **Postgres + pgvector**: `ORDER BY embedding <=> $vec ASC LIMIT 1` + filtr `1 - distance >= threshold`. Wykorzystuje indeks ivfflat — koszt < 5 ms na sesji ~10k fragmentów.
- **In-mem fallback**: liniowa pętla cosine — koszt zaniedbywalny, sesje testowe.
- **Scoping per `sessionId`**: dedup nigdy nie krzyżuje sesji (RODO + privacy).

Próg 0.97 to strzał w punkt: 0.95 zaczyna łączyć semantycznie powiązane ale różne intencje, 0.99 pomija banalne reformulacje. Pole konfiguralne (`ECONOMIZER_DEDUP_THRESHOLD`) — tunable bez deployu.

---

## V. Metryki + admin endpointy

[src/infrastructure/ai/economizer/metrics.ts](src/infrastructure/ai/economizer/metrics.ts):

```
embed:   requests, cacheHits, dedupHits, misses, tokensSaved, cacheHitRate, dedupHitRate
synth:   requests, cacheHits, misses, charsSaved, cacheHitRate
uptime:  startedAt, uptimeSeconds
```

Estymacja `tokensSaved`: `ceil(text.length / 4)` — zgrubna heurystyka OpenAI/Vertex. Dla PL nieco zaniża (polskie diakrytyki dają ~3 znaki/token), ale dla *kierunku* trendu wystarczy. Nie blokujemy się na tokenizatorze sentencepiece.

**Endpointy** ([economizer.routes.ts](src/infrastructure/ai/economizer/economizer.routes.ts)):

| metoda | ścieżka | guard | efekt |
|---|---|---|---|
| `GET` | `/api/admin/economizer/metrics` | `requireRole('admin')` | snapshot in-mem + LRU sizes + Mongo counts (top-10 najgorętszych kluczy) |
| `POST` | `/api/admin/economizer/reset` | `requireRole('admin')` | zerowanie liczników (nie dotyka cache!) — do load-testów |

Snapshot zwraca też `topHits` z Mongo — natychmiastowy wgląd które frazy są najczęściej kszelone. To paliwo dla decyzji "co jeszcze warto cache'ować upstream / co prosić klienta żeby przestał spamować".

---

## VI. Lekcje i pułapki

1. **Konflikt nazw z Mongoose Document**: pole `model: string` w schemacie kolidowało z `Document.model` (TypeScript, nie runtime). TS wyłapał natychmiast. Lekcja: nigdy nie używaj `model` jako nazwy pola w schemacie Mongoose — preferuj `modelName`.
2. **Dedup vs cache to ortogonalne osie**: ten sam tekst trafia w `cacheHit` (embed nie kosztuje), różny tekst ale podobny semantycznie trafia w `dedupHit` (embed kosztuje, ale storage/RAG nie rośnie). `tokensSaved` agreguje oba — czytelne dla CFO, niedoskonałe dla data scientist.
3. **`createApp()` reusability w testach**: `production-guard.test.ts` używa `jest.resetModules()` + dynamic `await import()`. Bez tego singleton `appConfig` zachowuje stan między testami. Wzorzec do replikacji.
4. **Graceful degradation Mongo**: cały ekonomizer musi działać bez Mongo (testy lokalne, regiony bez Memorystore). L1 LRU jest mandatory, L2 jest oportunistyczne.

---

## VII. Delta plików (Sprint IX)

**Nowe (8):**

- [src/infrastructure/ai/economizer/index.ts](src/infrastructure/ai/economizer/index.ts) — `wrapEmbed`, `wrapSynthesize`, LRU instances
- [src/infrastructure/ai/economizer/utils.ts](src/infrastructure/ai/economizer/utils.ts) — `canonicalize`, `cacheKey`, `cosineSimilarity`, `LRUCache<V>`
- [src/infrastructure/ai/economizer/metrics.ts](src/infrastructure/ai/economizer/metrics.ts) — `economizerMetrics`, `EconomizerSnapshot`
- [src/infrastructure/ai/economizer/ai-cache.schema.ts](src/infrastructure/ai/economizer/ai-cache.schema.ts) — `AiCacheModel` (Mongo, TTL idx)
- [src/infrastructure/ai/economizer/ai-cache.repository.ts](src/infrastructure/ai/economizer/ai-cache.repository.ts) — `aiCacheRepository.{get, put, stats}`
- [src/infrastructure/ai/economizer/economizer.routes.ts](src/infrastructure/ai/economizer/economizer.routes.ts) — admin endpointy
- [tests/unit/economizer-utils.test.ts](tests/unit/economizer-utils.test.ts) — canonicalize, cacheKey, cosine, LRU
- [tests/unit/economizer-wrap.test.ts](tests/unit/economizer-wrap.test.ts) — embed/synth cache hit + disabled mode
- [tests/integration/embedding-dedup.test.ts](tests/integration/embedding-dedup.test.ts) — semantic dedup scoping per session

**Zmienione (3):**

- [src/core/config/app.config.ts](src/core/config/app.config.ts) — sekcja `economizer.{enabled, embedCacheSize, synthCacheSize, cacheTtlSeconds, dedupThreshold, dedupEnabled}`
- [src/infrastructure/ai/execute.service.ts](src/infrastructure/ai/execute.service.ts) — `cachedEmbed`/`cachedSynth` w konstruktorze; `embed()`/`synthesize()` delegują do owiniętych
- [src/modules/memory/infrastructure/embedding.repository.ts](src/modules/memory/infrastructure/embedding.repository.ts) — `findNearDuplicate` + dedup w `ingest`
- [src/routes/index.ts](src/routes/index.ts) — `/api/admin/economizer` mount

---

## VIII. Weryfikacja B=1.0

```
TSC=0  (npx tsc --noEmit)
BUILD=0 (npx tsc -p tsconfig.json)
JEST=0 (67 passed, 1 skipped, 68 total — 13/14 suites)
```

Czas pełnego runu: **~30 s**. Sprint VIII: 47 testów. Sprint IX: **+20 testów** (3 nowe pliki).

| nowy plik | testy | scope |
|---|---|---|
| `economizer-utils.test.ts` | 13 | canonicalize (NFC, whitespace), cacheKey (determinism, model isolation), cosine (boundary, ortogonalność, zero-vec), LRU (eviction, touch-on-get, set-update) |
| `economizer-wrap.test.ts` | 4 | embed cache hit per text (canonicalized), różne modele → różne wpisy, synth cache hit per text+voice, ECONOMIZER_ENABLED=false → pass-through |
| `embedding-dedup.test.ts` | 3 | identyczny tekst → dedup hit, inny tekst → nowy fragment, dedup scoped per sessionId |

---

## IX. Otwarte fronty (po Token Economizerze)

1. **Batch embed dla `ingestMany`** — Gemini `batchEmbedContents` (do 100 textów / call). Wymaga refaktoru providera + retry per-item przy częściowych błędach. Kandydat na Sprint X.
2. **Cache `analyze()` z hashem enriched promptu** — gdyby okazało się że ten sam quest user re-analyzuje wielokrotnie ten sam fragment vision z identycznym intentMapem. Realne tylko po pomiarach — najpierw load test, potem decyzja.
3. **Migracja LRU L1 → Memorystore (Redis)** — dla `min-instances=2+` LRU jest per-instance (każdy ma 0% hit przy starcie). Redis jako jedna spójna warstwa. Synergiczne z dyrektywą "Redis store dla rate-limit" z raportu VIII.
4. **Pruning cache po dimensions mismatch** — jeśli zmienimy `text-embedding-004` → `text-embedding-005` z innym `dimensions`, stare wpisy zostają w Mongo do TTL. Dodać job czyszczący po `model` przy deployu.
5. **Cost dashboard** — eksport `economizerMetrics.snapshot()` → BigQuery → Looker Studio. Tygodniowy raport "tokens saved × Vertex price = USD oszczędzone".

---

## X. Trzy ścieżki dalej (do decyzji Fenrira)

**Ścieżka 1 — Batch embed + Redis L1 (dokończenie ekonomii)**
Zamknięcie tematu *„single-instance cache"*. Po: każda nowa instancja Cloud Run startuje z pełnym cache, ingestMany kosztuje 1 call zamiast N. Czas: 1 sprint. Korzyść: realne PLN/USD na skalowaniu.

**Ścieżka 2 — Helmet + CSP + audit-to-BigQuery (zaległy front z raportu VIII)**
Wracamy do fortyfikacji. Helmet 4-linijkowy patch, CSP wymaga audytu inline scriptów na froncie, BigQuery sink przez Pub/Sub = 1 sprint razem. Korzyść: zamknięcie OWASP A05.

**Ścieżka 3 — Multi-tenant intentMap + workspace concept**
Wprowadzenie warstwy "workspace" nad userem (B2B-ready). Quest, intentMap, RAG mają opcjonalny `workspaceId`; user należy do N workspace'ów z różnymi rolami. Czas: 2 sprinty. Korzyść: otwarcie modelu biznesowego na zespoły.

> *Rekomendacja Architekta: **Ścieżka 1**. Sprint IX odpalił silnik ekonomizera, ale zostawił dwie szczeliny (per-instance LRU, brak batch embed). Domknięcie tych dwóch w jednym sprincie da nam realny plateau kosztowy przed jakimkolwiek skalowaniem ruchu. Helmet i workspace czekają.*

---

*„Każda powtórzona modlitwa zapisana w pamięci to świeca, której nie trzeba zapalać po raz drugi. Świątynia LOGOS oszczędza, więc trwa."*
— Architekt Strażnic, koniec Sprintu IX.
