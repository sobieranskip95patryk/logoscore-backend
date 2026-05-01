# Raport V — v5.7.0-dev

**Kryptonim:** *Auto-Korelacja — pętla intencja → akcja → cel*
**Data:** 26 kwietnia 2026
**Bilans spójności:** B = 1.0 (utrzymane)
**Status rdzenia:** stabilny, pętla domknięta

---

## 1. Wchłonięte parametry Fenrira (sygnał IV)

| Parametr | Wartość | Plik |
|---|---|---|
| `RESOLVER_AUTO_CORRELATE` | **`true`** | [app.config.ts](src/core/config/app.config.ts) + [.env.development](env/.env.development) |
| `RESOLVER_MIN_SCORE` | **`0.65`** (z 0.55) | [.env.development](env/.env.development) |
| Filtrowanie wag | **raw → filtr, score×weight → sort** | [correlate-action.usecase.ts](src/modules/resolver/application/correlate-action.usecase.ts) |
| `RESOLVER_PARENT_DISCOUNT` | **`0.8`** | [app.config.ts](src/core/config/app.config.ts) |
| `AUDIT_SNAPSHOT_EVERY` | **`25`** | [app.config.ts](src/core/config/app.config.ts) |
| Manualny snapshot | `POST /api/memory/snapshot` | [memory.routes.ts](src/modules/memory/interfaces/memory.routes.ts) |

---

## 2. Pętla auto-korelacji

```
Klient → POST /api/logos/analyze | WS logos.stream
            │
            ▼
   analyzeQueryUseCase.run(sessionId, { query, uid })
            │
   [logos.analyze.started] ───┐
            │                  │
   embed RAG + intentMap       │  EventBus
   LLM analyze                 │   ↓
            │                  │  socket.gateway
   [logos.analyze.completed] ──┤   ↓
   ingest answer to vectors    │  WS room session:<id>
            │                  │
   fireAutoCorrelate() ─ async ┤
       │                       │
       embed(query, 1024D)     │
       cos vs goals.active     │
       parent propagation×0.8  │
       sort score × weight     │
            │                  │
   [resolver.correlation.computed]──→ frontend HTML
```

**Trzy bramki bezpieczeństwa** (wczesne wyjścia):
1. `appConfig.resolver.autoCorrelate === false` → skip
2. `uid === 'anonymous' || !uid` → skip (anonimowi nie mają `project_goals`)
3. `query` puste → skip

Auto-korelacja nigdy nie blokuje ścieżki głównej (fire-and-forget z `.catch()` logowania).

---

## 3. Algorytm korelacji v2 (propagacja hierarchii celów)

```
goals_active ← list(uid, 'active') ∩ has(embedding)
v ← embed(actionText, mxbai-embed-large, 1024D)

# 1. DIRECT — raw cosine ≥ minScore (czystość dopasowania)
direct = goals_active
  .map(g → { goalId, score = cos(v, g.emb), weight: g.weight })
  .filter(score ≥ 0.65)

# 2. PROPAGACJA przez parentId z dyskontem 0.8
for m in direct:
  cur, depth ← byId.get(m.goalId), 1
  propScore ← m.score
  while cur.parentId:
    propScore ← propScore × 0.8
    if propScore < 0.65: break
    propagate to parent (max-wins przy konflikcie goalId)
    cur, depth ← parent, depth+1

# 3. MERGE — direct ≻ propagated dla tego samego goalId

# 4. SORT — efektywne score × weight (priorytet celu decyduje rankingu)

# 5. SLICE — topK=5 → matches
dominant ← matches[0] ?? null
emit('resolver.correlation.computed', { actionRef, matches, dominant })
```

**Tłumienie hierarchii** (przykład):
- match na podcelu = 0.90 → propagacja do rodzica = 0.72
- drugi krok w górę = 0.576 → **odrzucony** (< 0.65)

Naturalne rozproszenie energii — system nie zalewa rodziców szumem.

---

## 4. Snapshot — hybryda auto+manual

**Interfejs** ([intent-map.repository.interface.ts](src/modules/memory/infrastructure/intent-map.repository.interface.ts)):
```ts
snapshot(sessionId, trigger?: 'manual' | 'auto'): Promise<SnapshotResult>
```

**Mongo backend** ([intent-map.mongo.repository.ts](src/modules/memory/infrastructure/intent-map.mongo.repository.ts)):
- `intent_audit.create({ action: 'snapshot', payload: { graph, nodes[], edges[] }, expiresAt: null })`
- Auto-trigger w `append()`: `if (version % 25 === 0) this.snapshot(sessionId, 'auto')` (fire-and-forget)
- Emit `memory.intent.updated` z `snapshot:true, trigger`

**Postgres backend**: snapshot = no-op (`skippedReason: 'postgres_backend_no_audit'`) — kontrakt zachowany, brak fałszywych sukcesów.

**Memory backend**: ten sam no-op — fallback nie udaje persystencji.

**Manual endpoint**:
```
POST /api/memory/snapshot
body: { sessionId }
→ 201 { sessionId, version, trigger: 'manual', ok: true }
→ 409 { ok: false, skippedReason: 'mongo_offline' | 'graph_not_found' | ... }
```

---

## 5. TTL audit — oddychanie bazy

| Akcja | `expiresAt` | Retencja |
|---|---|---|
| `create`, `replace`, `append`, `delete` | `now() + AUDIT_RETENTION_SECONDS` | 90 dni |
| `snapshot` | `null` | wieczność |

Index: `{ expiresAt:1, expireAfterSeconds:0 }` — Mongo czyści sam, backend nie traci cykli.

Krzywa retencji ustabilizowana: szum znika, kamienie milowe zostają.

---

## 6. Stan plików (delta wobec raportu IV)

| Plik | Status |
|---|---|
| [src/modules/logos/application/analyze-query.usecase.ts](src/modules/logos/application/analyze-query.usecase.ts) | EXT — `AnalyzeRunInput.uid?`, `fireAutoCorrelate()` w `run` + `runStream` |
| [src/modules/logos/interfaces/logos.controller.ts](src/modules/logos/interfaces/logos.controller.ts) | EXT — przekazuje `req.user?.uid` |
| [src/infrastructure/websocket/socket.gateway.ts](src/infrastructure/websocket/socket.gateway.ts) | EXT — `AnalyzePayload.uid?` propagowane do `runStream` |
| [src/modules/resolver/application/correlate-action.usecase.ts](src/modules/resolver/application/correlate-action.usecase.ts) | EXT — propagacja parent z dyskontem 0.8, raw-filter / weight-sort |
| [src/modules/memory/infrastructure/intent-map.repository.interface.ts](src/modules/memory/infrastructure/intent-map.repository.interface.ts) | EXT — `snapshot()` + `SnapshotResult` |
| [src/modules/memory/infrastructure/intent-map.mongo.repository.ts](src/modules/memory/infrastructure/intent-map.mongo.repository.ts) | EXT — `snapshot()` + auto-trigger co 25 mutacji |
| [src/modules/memory/infrastructure/intent-map.repository.ts](src/modules/memory/infrastructure/intent-map.repository.ts) | EXT — Postgres snapshot no-op + Proxy delegacja |
| [src/modules/memory/interfaces/memory.routes.ts](src/modules/memory/interfaces/memory.routes.ts) | EXT — `POST /snapshot` |
| [src/modules/memory/interfaces/memory.controller.ts](src/modules/memory/interfaces/memory.controller.ts) | EXT — `MemoryController.snapshot` |
| [src/core/config/app.config.ts](src/core/config/app.config.ts) | EXT — `resolver.autoCorrelate`, `parentDiscount`, `audit.snapshotEvery` |
| [env/.env.development](env/.env.development) | EXT — `RESOLVER_AUTO_CORRELATE=true`, `MIN_SCORE=0.65`, `PARENT_DISCOUNT=0.8`, `SNAPSHOT_EVERY=25` |

---

## 7. Weryfikacja B = 1.0

| Front | Wynik |
|---|---|
| `npx tsc --noEmit` | EXIT=0 |
| `npx jest --colors=false` | 4 passed / 1 skipped, EXIT=0 |
| `npx tsc -p tsconfig.json` | EXIT=0 |
| Frontend HTML kontrakt | nienaruszony — `BACKEND_URL`, audio PCM s16le, voice `Fenrir` |
| Adapter Pattern (intent-map ×3) | Mongo ↔ Postgres ↔ memory |
| Adapter Pattern (goals ×2) | Mongo ↔ memory |
| Anonimowi użytkownicy | bezpieczni — auto-korelacja pomija |

---

## 8. Powierzchnia REST (snapshot)

| Method | Path | Cel |
|---|---|---|
| `POST` | `/api/logos/analyze` | analiza + auto-korelacja (gdy uid≠anonymous) |
| `POST` | `/api/memory/snapshot` | manualny kamień milowy wizji |
| `POST` | `/api/resolver/correlate` | korelacja na żądanie (z propagacją) |
| `GET`  | `/api/resolver/goals?status=active` | lista celów (bez wektorów) |
| `POST` | `/api/resolver/goals` | nowy cel + async embedding 1024D |
| `POST` | `/api/resolver/goals/:goalId/reembed` | backfill wektora |
| `DELETE` | `/api/resolver/goals/:goalId` | archiwizacja |
| `GET`  | `/api/ready` | deep healthcheck (memory + resolver backend) |

WS:
- `logos.stream` (klient → server): `{ sessionId, query, imageData?, imageMimeType?, uid? }`
- `logos.event` (server → klient): broadcast EventBus, w tym `resolver.correlation.computed`

---

## 9. Otwarte fronty

1. **Testy integracyjne** (mongodb-memory-server):
   - audit TTL respektuje `expiresAt` (snapshot zostaje, append wygasa)
   - auto-snapshot co 25 mutacji generuje wpis z `expiresAt:null`
   - Proxy graceful (Mongo offline → memory fallback)
   - end-to-end `correlate` z deterministycznym `simulated` embedderem
   - propagacja parent: dopasowanie 0.90 → rodzic 0.72 (≥0.65) → dziadek 0.576 (odrzucony)
2. **WS handshake auth** — verify Firebase token w `socket.handshake.auth.token` zamiast ufania `payload.uid`. Domknie pętlę auto-korelacji dla streamingu z gwarancją tożsamości.
3. **Quest ↔ Resolver bridge** — listener na `quest.completed` → `correlateActionUseCase({ actionRef: 'quest:<id>', actionText: quest.title + description })`. Ukończony quest sam się rozlicza wobec celów.
4. **Snapshot timeline** — `GET /api/memory/snapshots?sessionId=...` zwracający chronologię kamieni milowych z payloadami grafów (paginacja).
5. **Atlas Vector Search dla `project_goals`** — gdy `count >> 10k`, podmiana in-process cosine na `$vectorSearch` (knnBeta, 1024D, cosine).

---

## 10. Pytania kontrolne do FELAI

1. **WS uid trust** — czy upgrade do Firebase handshake teraz, czy kontynuować budowę i utwardzić bezpieczeństwo w fazie hardening?
2. **Snapshot retention** — czy ograniczyć liczbę snapshotów per sessionId (np. ostatnie 50 + decimation), czy pełna wieczność?
3. **Quest correlation actionText** — `title` + `description` + `acceptanceCriteria`, czy tylko `title`?
4. **Resolver dla anonimowych** — czy umożliwić `project_goals` dla anonimowych pod sessionId (nie uid), czy utrzymać twardą bramkę uid?
5. **Propagacja w dół** — obecnie tylko dziecko→rodzic. Czy potrzebujemy też rodzic→dzieci (cele rodzica jako kontekst dla dzieci)?

---

## 11. Status końcowy

```
✅ Auto-korelacja:        wkuta w analyze (REST + WS)
✅ Min score:             0.65 — wyższa poprzeczka, mniej szumu
✅ Filtr/sort:            raw→filtr, weighted→sort
✅ Propagacja:            parent×0.8 z naturalnym tłumieniem
✅ Snapshot hybryda:      auto co 25 + manual endpoint
✅ TTL:                   90d szum / wieczność snapshoty
✅ Adapter Pattern:       intent-map ×3, goals ×2
✅ Bilans B:              1.0
✅ Build:                 zielony
🌒 Następny krok:         sygnał FELAI — testy integracyjne, WS auth lub quest bridge
```

Pętla domknięta. Wola krąży. Kuźnia czeka.
