# RAPORT XI — Observability Mesh: Eyes of Argos otwarte

> *"wyznaczam kierunek na Ścieżkę 1: Sprint XI: Observability Mesh. Bez absolutnej przejrzystości (Eyes of Argos), nawet najpotężniejszy system pozostaje ślepy na własną wielkość. Musimy widzieć przepływ każdej synapsy przez warstwy L0–L2, musimy czuć puls opóźnień p99 i monitorować hit-rate z precyzją chirurga... Przystąp do prac nad OpenTelemetry, Architekcie. Niech światło danych rozproszy mrok niepewności."*
> — Boski Umysł LOGOS, dyrektywa Fenrira

---

## I. Wchłonięte parametry

Sprint XI zamknięty. Mrok niepewności rozproszony. Dwadzieścia jeden
warstw kodu otwiera teraz Argosowi dwadzieścia jeden okien — każda
synapsa AI niesie ze sobą ślad: span, atrybuty, czas trwania, status.
Każda warstwa cache (L0/L1/L2) raportuje swój własny puls. Każdy
backend (PG/Mongo/Redis) ujawnia własne opóźnienie probe'a w
milisekundach. Wszystko bez jednej dodatkowej zależności runtime — bo
OpenTelemetry SDK ładowany jest *lazy*, a brak paczek degraduje system
do gracjalnego NoOp.

---

## II. LatencyHistogram — reservoir Vitter R, zero zewnętrznych zależności

[`src/infrastructure/observability/latency-histogram.ts`](src/infrastructure/observability/latency-histogram.ts)

- Capacity domyślne: **1024 próbek**
- Algorytm: **Vitter R reservoir sampling** — po przekroczeniu
  pojemności kolejna próbka trafia na pozycję
  `Math.floor(Math.random() * count)` jeśli `r < capacity`. Statystyka
  jest niezniekształcona dla nieograniczonego strumienia.
- API: `observe(ms)`, `percentile(p)`, `snapshot() → {count, min, max,
  mean, p50, p95, p99}`, `reset()`.
- **Zero npm dependencies.** Sortowana kopia reservoir przy każdym
  snapshot — koszt O(n log n) dla n ≤ 1024 (≈ kilkadziesiąt µs).

Pokrycie testami: [`tests/unit/latency-histogram.test.ts`](tests/unit/latency-histogram.test.ts) — 5 testów (empty, single, 100 wartości p50/p95/p99, reset, capacity overflow).

---

## III. Per-warstwę liczniki cache (L0 / L1 / L2)

[`src/infrastructure/ai/economizer/metrics.ts`](src/infrastructure/ai/economizer/metrics.ts) **przepisane od zera**:

- Typ `CacheLayer = 'l0' | 'l1' | 'l2'`.
- `EconomizerSnapshot` rozszerzony o:
  - `embed.layerHits: { l0, l1, l2 }`
  - `embed.layerHitRates: { l0, l1, l2 }` (znormalizowane do sumy hitów)
  - analogicznie dla `synth`
  - `latency.cacheLookupMs: { l0, l1, l2 }` — histogramy per warstwa
  - `latency.embedTotalMs`, `synthTotalMs`, `analyzeMs`, `embedBatchMs`,
    `providerEmbedMs`, `providerSynthMs` — histogramy per AI op
- API rejestrujące: `recordEmbedCacheHit(text, layer)`,
  `recordSynthCacheHit(text, layer)`, `observeCacheLookup(layer, ms)`,
  `observeProviderEmbed(ms)` itd.
- Łącznie **9 instancji `LatencyHistogram`** w jednym module.

[`src/infrastructure/ai/economizer/index.ts`](src/infrastructure/ai/economizer/index.ts) — `lookupEmbed` zwraca teraz `{ value, layer }`:

- L0 hit (Map LRU) → bezpośredni return + `observeCacheLookup('l0', dt)`.
- L1 hit (Redis) → hydratacja L0 + `observeCacheLookup('l1', dt)`.
- L2 hit (Mongo) → **write-back do L1 (Redis) + L0** + `observeCacheLookup('l2', dt)`.

Pokrycie testami: [`tests/unit/economizer-layers.test.ts`](tests/unit/economizer-layers.test.ts) — 4 testy z `jest.doMock` przed dynamic `await import()`.

---

## IV. OpenTelemetry SDK — lazy require + NoOp fallback

[`src/infrastructure/observability/telemetry.ts`](src/infrastructure/observability/telemetry.ts)

- Interfejsy `AppSpan` (setAttribute / setStatus / recordException / end), `AppTracer` (startSpan / withSpan).
- Domyślny `NoopTracer` zwracany **zawsze** dopóki `initTelemetry()` nie powiedzie się.
- `initTelemetry()`:
  - **idempotentne** (drugie wywołanie no-op),
  - lazy `require()` na: `@opentelemetry/sdk-node`, `exporter-trace-otlp-http`, `resources`, `semantic-conventions`, `auto-instrumentations-node`, `sdk-trace-base` (TraceIdRatioBasedSampler), `api`.
  - Dowolny błąd require → log + powrót do `NoopTracer`. **Brak paczek = system działa.**
- Resource attributes: `SERVICE_NAME`, `SERVICE_VERSION`, `DEPLOYMENT_ENVIRONMENT`.
- OTLPTraceExporter URL: `${endpoint}/v1/traces`.
- `getNodeAutoInstrumentations` z **`@opentelemetry/instrumentation-fs` wyłączonym** (zbyt szumna w Node).
- Hook `SIGTERM → sdk.shutdown()` dla czystego flush trace'ów na Cloud Run.
- `wrapOtelSpan(span, SpanStatusCode)` — translacja `'ok' → OK`, `'error' → ERROR`.

Pokrycie testami: [`tests/unit/telemetry-noop.test.ts`](tests/unit/telemetry-noop.test.ts) — 3 testy (TELEMETRY_ENABLED=false default, NoOp methods bezpieczne, withSpan zwraca wartość i propaguje wyjątek).

---

## V. Custom spans w ExecuteService

[`src/infrastructure/ai/execute.service.ts`](src/infrastructure/ai/execute.service.ts) — każda operacja AI w spanie:

| Operacja      | Span name        | Attrs                                       |
|---------------|------------------|----------------------------------------------|
| `analyze`     | `ai.analyze`     | `ai.provider`                                |
| `synthesize`  | `ai.synthesize`  | `ai.provider`, `ai.text_length`              |
| `embed`       | `ai.embed`       | `ai.provider`, `ai.text_length`              |
| `embedBatch`  | `ai.embedBatch`  | `ai.provider`, `ai.batch_size`               |

Każdy span domyka `getTracer().withSpan(...)` — `OK` przy sukcesie,
`ERROR + recordException` przy throw. Histogramy
(`observeAnalyze` / `observeProviderEmbed` / itd.) wywoływane w
`finally` — zerowy koszt przy NoOp.

---

## VI. Health vs Readiness — chirurgiczne rozróżnienie

[`src/routes/index.ts`](src/routes/index.ts)

- **`/api/health`** = **liveness only**, zawsze 200, zwraca
  `{status, service, version}`. Brak deep-probe — dla kubelet/Cloud Run
  (decyzja restartu nie powinna zależeć od stanu Mongo).
- **`/api/ready`** = **readiness deep-probe**:
  - Helper `async function timed<T>(fn): Promise<{value, ms}>`.
  - `Promise.all` na `pingPostgres / pingMongo / pingRedis`.
  - Status **503** jeśli `!postgres || !mongo` (Redis opcjonalny —
    brak Redis nie wyłącza serwisu, tylko degraduje cache).
  - Per-backend `latencyMs` w odpowiedzi + total `probeMs`.
  - Pole `backends.redis.required = false`.

Pokrycie: [`tests/integration/health-endpoints.test.ts`](tests/integration/health-endpoints.test.ts) — 3 testy.

---

## VII. Lekcje wchłonięte

1. **Init telemetrii MUSI być pierwszą operacją w `server.ts`** — auto-instrumentacja patchuje moduły przy `require`. Import `createApp` PO `initTelemetry()`. Naruszenie kolejności = brak instrumentacji HTTP/Express.
2. **`jest.doMock` przed dynamic `await import()`** to wzorzec dla mockowania singletonów w modułach trzymających prywatny state. Statyczny `import` cache'uje moduł zanim mock zostanie zarejestrowany.
3. **Lazy require + NoOp fallback** = paczki opcjonalne. `package.json` nie deklaruje `@opentelemetry/*` jako runtime deps. Test NoOp przechodzi *właśnie dlatego*, że paczki nie są zainstalowane.
4. **Reservoir sampling** dla histogramów — stałe O(capacity) memory, niezniekształcony estymator percentyli przy nieskończonym strumieniu. Lepsze niż naiwny `array.push` (rośnie bez ograniczeń) i niż HDR Histogram (waga zależności).

---

## VIII. Delta plików

### Nowe (3 src + 3 testy)
- [src/infrastructure/observability/latency-histogram.ts](src/infrastructure/observability/latency-histogram.ts)
- [src/infrastructure/observability/telemetry.ts](src/infrastructure/observability/telemetry.ts)
- [tests/unit/latency-histogram.test.ts](tests/unit/latency-histogram.test.ts)
- [tests/unit/telemetry-noop.test.ts](tests/unit/telemetry-noop.test.ts)
- [tests/unit/economizer-layers.test.ts](tests/unit/economizer-layers.test.ts)
- [tests/integration/health-endpoints.test.ts](tests/integration/health-endpoints.test.ts)

### Zmienione
- [src/infrastructure/ai/economizer/metrics.ts](src/infrastructure/ai/economizer/metrics.ts) — przepisane od zera (per-layer + 9 histogramów).
- [src/infrastructure/ai/economizer/index.ts](src/infrastructure/ai/economizer/index.ts) — `lookupEmbed→{value,layer}`, write-back L2→L1+L0, observe per warstwa.
- [src/infrastructure/ai/execute.service.ts](src/infrastructure/ai/execute.service.ts) — `withSpan` + `observe*` wokół 4 operacji.
- [src/server.ts](src/server.ts) — `initTelemetry()` PRZED `import { createApp }`.
- [src/routes/index.ts](src/routes/index.ts) — split `/api/health` (liveness) vs `/api/ready` (deep-probe + 503 + latencyMs).
- [src/core/config/app.config.ts](src/core/config/app.config.ts) — sekcja `telemetry: {enabled, otlpEndpoint, serviceName, sampleRate, prometheusEnabled}`.

---

## IX. Weryfikacja B = 1.0

| Bramka                 | Komenda                                | Wynik                |
|------------------------|----------------------------------------|----------------------|
| Type-check źródeł      | `npx tsc --noEmit`                     | **EXIT = 0**         |
| Test suite (jest)      | `npx jest --colors=false`              | **91 passed / 1 skipped / 0 failed** (20/21 suites) |
| Build produkcyjny      | `npx tsc -p tsconfig.json`             | **EXIT = 0**         |

**B = 1.0** — wszystkie trzy zielone bramki Build Health. Delta vs Sprint X: **+15 testów** (76 → 91; +5 latency, +3 telemetry-noop, +4 economizer-layers, +3 health-endpoints).

---

## X. Otwarte fronty

1. **Prometheus exporter** — `app.config.telemetry.prometheusEnabled` zarezerwowane, ale endpoint `/metrics` z `prom-client` jeszcze nie podpięty.
2. **OTel Collector deployment na GCP** — Cloud Trace + Cloud Monitoring ingest przez sidecar/agent. Wymaga Cloud Run service config (sidecar container + IAM `roles/cloudtrace.agent`).
3. **Trace exemplars** — linkowanie histogramów Prometheus do trace ID dla bezpośredniej drill-down nawigacji (Grafana/Cloud Monitoring).
4. **Sampling adaptacyjny** — obecnie `TraceIdRatioBasedSampler(sampleRate)` statyczny. Możliwa migracja do `ParentBased` + `RateLimitedSampler` dla burst-protection.
5. **Quest/Memory module spans** — custom spans tylko w `ExecuteService`. Warto dodać dla `QuestResolver`, `EmbeddingRepository.ingestMany`, `IntentMapRepository.resolve`.

---

## XI. Trzy ścieżki dalej

### Ścieżka 1 — **Cloud Run Deployment Hardening**
Realizacja Fazy III planu v6.0: Dockerfile multi-stage z `distroless`,
`.dockerignore`, `cloudbuild.yaml`, Workload Identity Federation,
Secret Manager dla `FIREBASE_SERVICE_ACCOUNT_PATH` /
`POSTGRES_PASSWORD`, Cloud Run service YAML z liveness `/api/health` +
readiness `/api/ready`, sidecar OTel Collector. Domknięcie ścieżki na
produkcję.

### Ścieżka 2 — **Quest Engine Expansion**
Multi-step quest resolver (DAG zadań z dependencies), reward economy
(token/badge/streak), socialne quest'y (party/raid), webhook outbound
do Discord/Slack po `quest.completed`. Wzbogacenie warstwy domenowej
przed skalowaniem.

### Ścieżka 3 — **Multi-tenant Workspaces**
Izolacja per workspace: `workspaceId` w każdym agregacie, RLS w
Postgres (`SET app.workspace_id`), prefix `ws:{id}:` w Redis,
`workspaceId` w embeddings/intent-maps. Otwarcie drogi do B2B SaaS.

---

> *Argos otworzył dwadzieścia jeden oczu. Każdy ślad widoczny, każdy puls policzony, każdy backend zważony w milisekundach. Mrok niepewności rozproszony — światło danych zalało warstwy L0–L2. Sprint XI zamknięty pieczęcią B = 1.0.*

— Architekt MTAQuest, Sprint XI complete.
