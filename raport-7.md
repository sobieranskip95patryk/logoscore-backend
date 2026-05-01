# Raport Sprintu VII — Resolver Loop Closure & Test Harness (v5.9.0-dev)

> *„Eliminacja resztkowej entropii. Niech LogosCore ewoluuje w kierunku absolutnej doskonałości."* — sygnał VI

Faza I, etap pierwszy. System dostał **drugą połowę pętli** — to, czego nie robi, też się rozlicza. Quest, który padł, nie znika cicho — staje przed Resolverem ze znakiem ujemnym, by mapa intencji nauczyła się odróżniać czyny owocne od jałowych. Równolegle: timeline snapshotów wyszedł z archiwum na powierzchnię (REST), a piramida testów dostała fundament — supertest end-to-end + 100% coverage warstwy domenowej questa.

---

## I. Wchłonięte parametry sygnału VI

| Dyrektywa | Implementacja |
|---|---|
| Quest fail loop = lustro Complete | [FailQuestUseCase](src/modules/quest/application/fail-quest.usecase.ts) — `IN_PROGRESS → FAILED` + emit `quest.failed` |
| Resolver uczy się czego unikać | [correlateActionUseCase](src/modules/resolver/application/correlate-action.usecase.ts) z `polarity: 'positive' \| 'negative'` (sign × score) |
| Snapshoty wychodzą z archiwum | [GET /api/memory/snapshots?from&to&limit](src/modules/memory/interfaces/memory.controller.ts) — timeline z Mongo audit |
| Test harness dla pętli | supertest end-to-end: start → complete → fail + unit polarity + 100% reguł questa |
| Coverage gate | Jest `coverageThreshold` na `quest/domain/` ≥70% (osiągnięte 100%) |

---

## II. Anti-D Reasoning: ujemna polaryzacja

### Geometria sygnału

```
quest.completed (positive)        quest.failed (negative)
        │                                  │
        ▼                                  ▼
  correlateAction(polarity='positive')   correlateAction(polarity='negative')
        │                                  │
        ▼                                  ▼
  matches: score = +cosine             matches: score = -cosine
        │                                  │
        ▼                                  ▼
  emit resolver.correlation.computed   emit resolver.correlation.negative
```

Bridge resolvera ([`correlateFromQuest`](src/modules/resolver/application/quest-bridge.ts)) dostał drugiego nasłuchowca. Te same bramki bezpieczeństwa (anonim → no-op, autoCorrelate → no-op, pusty actionText → no-op), tylko parametr polaryzacji różny. Score zapisywany ze znakiem (`-cosine` dla fail) — konsumenci downstream (przyszły dashboard) mogą sumować po user × goal i widzieć **wektor netto**: ile zrobiono dla celu, ile od niego odepchnięto.

### Decyzja architektoniczna: pusty wynik nie publikuje eventu

Gdy `goals.length === 0`, korelacja zwraca pusty wynik **bez** emitowania zdarzenia (positive ani negative). Pusta lista to nie sygnał — to brak sygnału. Test [correlate-polarity.test.ts](tests/unit/correlate-polarity.test.ts) zabezpiecza tę inwariantę.

---

## III. Snapshot Timeline — archiwum staje się narzędziem

### Endpoint

```http
GET /api/memory/snapshots?sessionId=...&from=2026-01-01&to=2026-04-26&limit=100
```

Response:
```json
{
  "sessionId": "...",
  "count": 7,
  "snapshots": [
    { "version": 175, "trigger": "auto", "createdAt": "2026-04-26T...", "nodes": 12, "edges": 18 },
    ...
  ]
}
```

### Backend matrix

| Backend | Zachowanie |
|---|---|
| **Mongo** ([listSnapshots](src/modules/memory/infrastructure/intent-map.mongo.repository.ts)) | Pełna lista z `intent_audit` (`action='snapshot'`), filtr `from/to/limit ≤ 500` |
| **Postgres** ([listSnapshots](src/modules/memory/infrastructure/intent-map.repository.ts)) | Zwraca `[]` (graceful) — Postgres nie utrzymuje audit-trail |
| **Memory** | Zwraca `[]` |

Adapter Pattern broni się ponownie — jeden interfejs `IIntentMapRepository.listSnapshots()`, trzy implementacje, zero złamań kontraktu.

---

## IV. Test Harness — pierwsze fale piramidy

### Nowe testy (5 plików, 19 passed / 1 skipped)

| Plik | Zakres |
|---|---|
| [tests/integration/quest-resolver.test.ts](tests/integration/quest-resolver.test.ts) | E2E: start→complete→event, start→fail→event, podwójny complete→409 |
| [tests/integration/snapshot-timeline.test.ts](tests/integration/snapshot-timeline.test.ts) | E2E: GET /snapshots bez Mongo zwraca pustą listę 200 |
| [tests/unit/correlate-polarity.test.ts](tests/unit/correlate-polarity.test.ts) | polarity default + negative bez goals nie emituje |
| [tests/unit/quest.rules.test.ts](tests/unit/quest.rules.test.ts) (rozbudowa) | Wszystkie reguły + `questActionText` |

### Stack testowy

- **supertest 7.x** + `@types/supertest` (devDep)
- `process.env.ALLOW_ANONYMOUS=true` per-test plik (izolacja od konfigu produkcyjnego)
- `process.env.AI_PROVIDER=simulated` (zero zewnętrznego I/O)
- Bridge `installQuestResolverBridge()` montowany w `beforeAll` — idempotentne dzięki `installed` guard

### Coverage (po sprincie VII)

| Warstwa | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `quest/domain/` | **100%** | 94.44% | **100%** | **100%** |
| `quest/application/` | 64.91% | 9.09% | 60% | 71.15% |
| `resolver/application/quest-bridge.ts` | 78.26% | 66.66% | 80% | 94.73% |
| `quest/interfaces/quest.routes.ts` | **100%** | **100%** | **100%** | **100%** |

**Coverage threshold w `jest.config.js`** ([jest.config.js](jest.config.js)): `quest/domain/ ≥ 70/60/70/70` — egzekwowane przy każdym `jest`. Dług coverage dla `application` / `infrastructure` / `interfaces` zostaje na sprint VIII (security harness pociągnie kolejne ścieżki testowe).

---

## V. Delta plików

| Plik | Zmiana |
|---|---|
| [quest.rules.ts](src/modules/quest/domain/quest.rules.ts) | + `ensureFailable()` |
| [event.types.ts](src/core/events/event.types.ts) | + `'quest.failed'`, + `'resolver.correlation.negative'` |
| [correlation.entity.ts](src/modules/resolver/domain/correlation.entity.ts) | + `polarity: 'positive' \| 'negative'` w `CorrelationResult` |
| [correlate-action.usecase.ts](src/modules/resolver/application/correlate-action.usecase.ts) | + `polarity` w input, sign × score, dwa różne event names |
| [fail-quest.usecase.ts](src/modules/quest/application/fail-quest.usecase.ts) | **NEW** — lustro `complete-quest` z `reason` |
| [quest-bridge.ts](src/modules/resolver/application/quest-bridge.ts) | + nasłuch `quest.failed` z `polarity='negative'` (refactor na `correlateFromQuest`) |
| [intent-map.repository.interface.ts](src/modules/memory/infrastructure/intent-map.repository.interface.ts) | + `SnapshotEntry`, `SnapshotQuery`, `listSnapshots()` |
| [intent-map.mongo.repository.ts](src/modules/memory/infrastructure/intent-map.mongo.repository.ts) | + implementacja `listSnapshots()` z filtrem czasowym |
| [intent-map.repository.ts](src/modules/memory/infrastructure/intent-map.repository.ts) | + Postgres no-op `listSnapshots()` + Proxy delegation |
| [memory.controller.ts](src/modules/memory/interfaces/memory.controller.ts) | + handler `listSnapshots` |
| [memory.routes.ts](src/modules/memory/interfaces/memory.routes.ts) | + `GET /snapshots` |
| [quest.controller.ts](src/modules/quest/interfaces/quest.controller.ts) | + handler `fail` |
| [quest.routes.ts](src/modules/quest/interfaces/quest.routes.ts) | + `POST /fail` |
| [schemas.ts](src/shared/validators/schemas.ts) | + `failQuestSchema` |
| [jest.config.js](jest.config.js) | + `collectCoverageFrom` + `coverageThreshold` |
| [tests/integration/quest-resolver.test.ts](tests/integration/quest-resolver.test.ts) | **NEW** |
| [tests/integration/snapshot-timeline.test.ts](tests/integration/snapshot-timeline.test.ts) | **NEW** |
| [tests/unit/correlate-polarity.test.ts](tests/unit/correlate-polarity.test.ts) | **NEW** |
| [tests/unit/quest.rules.test.ts](tests/unit/quest.rules.test.ts) | rozbudowa: 12 nowych asercji |
| `package.json` | + devDep `supertest` + `@types/supertest` |

---

## VI. Weryfikacja B = 1.0

```
npx tsc --noEmit                       → EXIT 0
npx jest --colors=false --coverage     → 19 passed, 1 skipped (EXIT 0)
                                          quest/domain coverage gate ≥70% met
npx tsc -p tsconfig.json               → BUILD 0
```

Cztery sprawdziany. Cztery zielone. Coverage gate pierwszy raz w historii projektu — i przeszedł z zapasem (100/94/100/100 vs próg 70/60/70/70).

---

## VII. Otwarte fronty (po sprincie VII)

- **Sprint VIII** — Security & Auth Hardening: WS handshake auth, RBAC, RODO endpoints, audit log, Cloud Armor-ready rate limiting
- **Coverage application/infrastructure** — pociągnie się przy testach RBAC i scenariuszach audytowych
- **`resolver.correlation.negative` consumer** — narzędzie do agregacji wektora netto (na razie tylko event leci)
- **Snapshot diff endpoint** — `?compare=v1,v2` zwracający delta nodes/edges (nice-to-have)

---

## VIII. Trzy ścieżki dalej

1. **Sprint VIII — Security Harden** (planowo następny): WS handshake Firebase + RBAC + RODO + rate-limit. To zamyka Fazę I i otwiera drogę do GCP-native refactor.
2. **Resolver consumer dashboard** — endpoint agregujący `goal_id × polarity × score` per user, podstawa pod future UI „mapa nadziei i porażek".
3. **Snapshot diff API** — `GET /api/memory/snapshots/diff?from=v10&to=v17` zwracający dodane/usunięte węzły i krawędzie. Zamyka koło sprintu VII przed pierwszym wdrożeniem na GCP.

Status dominacji: **rezolwer dostał drugie oko**. Sprint VII zamknięty, B=1.0, coverage gate wzniesiony.

Którą falą prowadzimy następny obrót koła?
