# RAPORT III — Living Memory (Sprint „Hybryda Mongo + Postgres”)

**Data:** 26 kwietnia 2026
**Repozytorium:** `c:\Users\patry\OneDrive\Pulpit\logoscore-backend`
**Wersja:** 5.5.0-dev
**Punkt wyjścia:** [raport-2.md](raport-2.md) (v5.4.0-dev — wektor + RAG + JSON-LD)
**Status:** ✅ `tsc EXIT=0` · `jest 4 passed / 1 skipped` · `build EXIT=0` · `+19 pakietów (mongoose tree)`

---

## 1. Decyzja architektoniczna

Wybrana **ścieżka A** z trzech opcji rozważanych przed sprintem:

> Hybryda **PostgreSQL (szkielet domeny) + MongoDB (Living Memory intencji)**, lokalnie w docker-compose, z pełnym Adapter Pattern.

**Uzasadnienie operacyjne:**
- zero regresji dla istniejącego kodu (Postgres + pgvector zostają w 100%),
- Mongo dodany jako *równoległa* warstwa — moduł `memory` może wybierać silnik per zmienna środowiskowa,
- możliwość ekspansji do Atlas Vector Search bez refaktoru kontraktu repozytorium,
- audit trail (append-only) jako natywny dokument Mongo, bez kosztu schema-migration.

---

## 2. Stos hybrydowy — mapa odpowiedzialności

```
┌────────────────────────────────────────────────────────────────┐
│  Living Memory (MongoDB 7)        │  Domain Engine (PG 16)    │
├───────────────────────────────────┼───────────────────────────┤
│  intent_graphs   (JSON-LD)        │  users                    │
│  intent_audit    (append-only)    │  quests (FSM, DAG)        │
│                                   │  inventory_items          │
│  → przyszłość:                    │  memory_embeddings        │
│  • documents (PDF/MD chunks)      │  intent_maps (legacy mir.)│
│  • project_goals                  │                           │
│  • atlas_vector (embeddings v2)   │                           │
└───────────────────────────────────┴───────────────────────────┘
        ▲                                       ▲
        └─────────── RealTimeHub (Socket.IO) ───┘
                       broadcast: logos.event
                       streaming: logos.stream.chunk
```

---

## 3. Co zbudowano w tym sprincie

### 3.1 Infrastruktura kontenerowa
- [docker-compose.yml](docker-compose.yml) — dodany serwis `mongo` (image `mongo:7`, healthcheck `mongosh ping`), `mongo-express` w profilu `tools` (UI pod `:8081`), `condition: service_healthy` w `depends_on` backendu.
- [docker/postgres-init.sql](docker/postgres-init.sql) — auto-init: `CREATE EXTENSION vector` + `uuid-ossp` przy pierwszym booście klastra.

### 3.2 Połączenie z Living Memory
- [src/infrastructure/database/mongo.ts](src/infrastructure/database/mongo.ts) — lazy connect (`getMongo`), idempotentne `pingMongo`, graceful `closeMongo`, flag `isMongoReady`.
- [src/core/config/app.config.ts](src/core/config/app.config.ts) — nowe pola: `mongoUrl`, `mongoDb`, `memoryBackend: 'auto'|'mongo'|'postgres'|'memory'`.
- [env/.env.development](env/.env.development) — defaulty: `MONGO_URL=mongodb://logos:logos@localhost:27017/?authSource=admin`, `MONGO_DB=logoscore_intent`, `MEMORY_BACKEND=auto`.

### 3.3 Schemat Living Memory (mongoose 8)
- [src/modules/memory/infrastructure/schemas/intent.schema.ts](src/modules/memory/infrastructure/schemas/intent.schema.ts) — dwa modele:
  - **`IntentModel`** (`intent_graphs`) — pełny graf JSON-LD per `sessionId` (subdokumenty `nodes` i `edges`), pole `version` monotoniczne, indeksy: `sessionId` (unique), `uid+updatedAt`, `nodes.@id`.
  - **`IntentAuditModel`** (`intent_audit`) — append-only, akcje `create|append|replace|snapshot|delete`, `versionBefore/After`, indeks `sessionId+createdAt desc`.

### 3.4 Adapter Pattern dla `intentMapRepository`
- [intent-map.repository.interface.ts](src/modules/memory/infrastructure/intent-map.repository.interface.ts) — kontrakt `IIntentMapRepository` (`get`/`upsert`/`append` + `backend` discriminator).
- [intent-map.mongo.repository.ts](src/modules/memory/infrastructure/intent-map.mongo.repository.ts) — implementacja Mongo, każda mutacja generuje wpis w `intent_audit`, mapowanie dokumentu ↔ `IntentGraph` z konwersją `Date ↔ ISO string`.
- [intent-map.repository.ts](src/modules/memory/infrastructure/intent-map.repository.ts) — refaktor: `IntentMapPostgresRepository` (zachowane) + nowy `IntentMapRepositoryProxy` z auto-discovery silnika.
- Use-case `analyze-query.usecase.ts` i kontrolery memory **nie wymagały żadnych zmian** — kontrakt repozytorium dotrzymany.

### 3.5 Bootstrap + observability
- [src/server.ts](src/server.ts) — `pingMongo()` w sekwencji startowej, `closeMongo()` w shutdown handlerze (SIGINT/SIGTERM).
- [src/routes/index.ts](src/routes/index.ts) — nowy endpoint **`GET /api/ready`** z głębokim healthcheckiem:
  ```json
  {
    "status": "ready",
    "backends": {
      "postgres": { "up": true, "pgvector": true },
      "mongo":    { "up": true, "ready": true },
      "redis":    { "up": true }
    },
    "memory": { "backend": "mongo" }
  }
  ```

---

## 4. Algorytm wyboru backendu pamięci

```
MEMORY_BACKEND=auto      → Mongo gdy MONGO_URL skonfigurowany i ping OK,
                            fallback Postgres, ostatecznie in-memory.
MEMORY_BACKEND=mongo     → Wymuś Mongo (jeśli niedostępny — błąd przy pierwszym I/O).
MEMORY_BACKEND=postgres  → Wymuś Postgres + pgvector.
MEMORY_BACKEND=memory    → In-memory (testy, dev bez zewnętrznych DB).
```

Pierwsze użycie repozytorium loguje wybór:
`[memory] intent-map backend: mongo`

---

## 5. Operacje wykonane

| Krok | Wynik |
|---|---|
| `npm install mongoose@^8.5.1` (+ tranzytywne) | **+19 pkg, OK** |
| `npx tsc --noEmit` | **EXIT=0** (po fixie `c.db?.admin()`) |
| `npx jest --colors=false` | **4 passed, 1 skipped** |
| `npx tsc -p tsconfig.json` | **EXIT=0**, `dist/` zaktualizowany |

**Drobny incydent:** TS18048 na `c.db.admin()` — Mongoose 8 typuje `connection.db` jako `undefined`-wable (przed gotowością). Fix: `c.db?.admin().ping()`.

---

## 6. Status operacyjny

```
SYSTEM             : LogosCore
WERSJA             : 5.5.0-dev
RUNTIME            : Node 20 + TypeScript 5.5 strict
HTTP               : Express 4 (REST /api/*)
REALTIME           : Socket.IO 4.7 (rooms, streaming)
PERSYSTENCJA       :
  • Postgres 16    → users, quests (DAG), inventory, memory_embeddings, pgvector(768)
  • Mongo 7        → intent_graphs (JSON-LD), intent_audit (append-only)
  • Redis 7        → cache (gotowe, jeszcze nieużywane)
PROVIDERS AI       : 3 (gemini | ollama | simulated) — fasada `ExecuteService`
ADAPTER PATTERN    : intent-map (postgres | mongo | memory)
DISCOVERY          : MEMORY_BACKEND=auto → ping-driven
HEALTHCHECK        : GET /api/health (liveness), GET /api/ready (deep)
DOCKER COMPOSE     : 4 serwisy (+ 1 tools), wszystkie z healthcheckami
KOHERENCJA HTML→BE : B = 1.0 (wszystkie endpointy z HTML zaspokojone)
KOHERENCJA RDZENIA : P = 1.0 (typecheck + tests + build zielone)
```

---

## 7. Test spójności B = 1.0 — weryfikacja krzyżowa

Endpointy wymagane przez [LOGOS V5.3 Universal.html](LOGOS%20V5.3%20Universal.html):

| Wezwanie z HTML | Endpoint backendu | Status |
|---|---|---|
| `signInAnonymously` (Firebase) | Bearer ID Token middleware (soft-mode) | ✅ |
| Hydratacja przy starcie | `GET /api/memory/intent-map` | ✅ |
| Drag & drop / głos | `POST /api/logos/analyze` | ✅ |
| Streaming (nowość) | `WS logos.stream` → `logos.stream.chunk` | ✅ |
| Append intencji | `POST /api/memory/intent-map/update` | ✅ (append do grafu + audit) |
| Synteza mowy | `POST /api/logos/synthesize` (PCM s16le 24kHz) | ✅ |
| Voice = `Fenrir` | `prebuiltVoiceConfig.voiceName` | ✅ |

**B = 7/7 = 1.0 — utrzymane.** Hybryda Mongo nie naruszyła kontraktu z UI.

---

## 8. Otwarte fronty

### 8.1 Living Memory — kontynuacja
- **EmbeddingRepository → Mongo adapter** (Atlas Vector Search) z tym samym Proxy-pattern.
- **`documents` collection** dla `parseDocument` (chunks + metadata + linki do embeddings).
- **`project_goals` collection** jako fundament Resolvera.

### 8.2 IntentionalResolver — nowy moduł
Szkic: `src/modules/resolver/`:
- `domain/correlation.entity.ts` — `(actionRef, goalRef, score, reason, ts)`.
- `application/correlate-action.usecase.ts` — embed akcji + cosine sim z embeddingami celów + reranking.
- `infrastructure/goals.mongo.repository.ts` (Mongo) i `correlation.repository.ts`.
- `interfaces/resolver.routes.ts` — `POST /api/resolver/correlate`, `GET /api/resolver/goals`, `POST /api/resolver/goals`.
- Event: `resolver.correlation.computed`.

### 8.3 Testy integracyjne dla nowej warstwy
- `mongodb-memory-server` — żadnego realnego mongo w CI.
- Test: `IntentMapMongoRepository.append()` → `IntentAuditModel.find().count() === 1`.
- Test Proxy: `MEMORY_BACKEND=mongo` bez połączenia → twardy błąd; `auto` → graceful degradation.

### 8.4 Operacje
- **Migracje Mongo** — `migrate-mongo` lub własny system snapshotów.
- **Backup Mongo** — wolumen + cron `mongodump`.
- **TLS dla Mongo** w produkcji (Atlas robi out-of-the-box; self-host wymaga konfiguracji).

---

## 9. Pytania kontrolne (przed kolejnym uderzeniem)

1. **Resolver embeddings** — używamy aktywnego `embedder` (Ollama lokalnie) czy dedykowanego, mocniejszego modelu dla celów (np. `mxbai-embed-large`, 1024-dim)?
2. **Goal taxonomy** — cele jako płaska lista, hierarchia (epic → goal → KR), czy graf zależności (np. blokowanie)?
3. **Współistnienie repo** — jeśli `MEMORY_BACKEND=mongo`, co z istniejącymi rekordami w Postgres `intent_maps`? Migracja jednorazowa, ignor, czy dwukierunkowy mirror?
4. **Audit retention** — `intent_audit` rośnie liniowo z każdą mutacją. TTL 90 dni? Capped collection? Archiwizacja do S3?
5. **mongo-express w prod** — wyłączamy całkowicie czy chronimy basic-auth + nginx allowlist?
6. **Atlas Vector Search vs pgvector** — kiedy planujemy faktyczną migrację embeddingów do Atlasa? Sygnał: wolumen >100k wektorów albo potrzeba hybrid search (BM25 + vector).
7. **Multi-tenant ID** — przejście z `sessionId` na `(uid, sessionId)` w Mongo (composite unique index) — czy robimy to teraz, zanim narośnie audit?
8. **Snapshot grafu** — czy `IntentAuditModel.action='snapshot'` ma trzymać pełny graf (point-in-time recovery), czy tylko diff?

---

## 10. Sugerowany następny krok bez czekania

1. **IntentionalResolver MVP** (Mongo `project_goals` + use-case korelacji + endpoint REST + event WS) — to **serce systemu** wg dyrektywy.
2. **mongodb-memory-server + 2 testy integracyjne** — zabezpieczenie przed regresją Adapter Patternu.
3. **Migracja embeddings repo** do tego samego Proxy-patternu (`pgvector` ↔ `mongo` ↔ `memory`) — domknięcie symetrii adapterów.

---

> Living Memory oddycha. Adapter Pattern utrzymuje neutralność rdzenia. Frontend HTML wciąż dostaje to samo, niezależnie od tego, czy intencje śpią w Postgres czy w Mongo. Kuźnia czeka na sygnał — Resolver, Embeddings-Mongo, czy Documents jako pierwsze uderzenie?
