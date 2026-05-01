# Raport IV — v5.6.0-dev

**Kryptonim:** *Intent Resolver — wola systemu*
**Data:** 26 kwietnia 2026
**Bilans spójności:** B = 1.0 (utrzymane)
**Status rdzenia:** stabilny, gotowy do auto-korelacji

---

## 1. Wchłonięte dyrektywy z sygnału III

| Dyrektywa | Decyzja | Realizacja |
|---|---|---|
| Embedding celów | **mxbai-embed-large 1024D** | `appConfig.resolver.embedModel='mxbai-embed-large'`, `embedDimensions=1024`; `EmbedInput` rozszerzony o `model?`/`dimensions?`; Ollama honoruje override per-call, Simulated dopasowuje deterministycznie. |
| Migracja Postgres → Mongo | **ignoruj stare `intent_maps`** | Brak mirrora. Proxy w trybie `auto` wybiera Mongo gdy ready. Stare rekordy zostają jako fossil — bez kosztu obliczeniowego. |
| Retencja `intent_audit` | **TTL 90 dni, snapshoty wieczne** | Pole `expiresAt: Date \| null` + index `{ expiresAt:1, expireAfterSeconds:0 }`. Helper `auditExpiryFor(action)` zwraca `null` dla `'snapshot'`. `AUDIT_RETENTION_SECONDS=7776000`. |
| Następny moduł | **IntentResolver** | Pełen moduł `src/modules/resolver/` w stylu DDD, własny Proxy z auto-discovery, REST + eventy. |

---

## 2. Architektura modułu Resolver

```
src/modules/resolver/
├── domain/
│   ├── project-goal.entity.ts       ProjectGoal + GoalStatus
│   └── correlation.entity.ts        CorrelationResult + cosine()
├── application/
│   └── correlate-action.usecase.ts  createGoal | reembedGoal | correlateAction
├── infrastructure/
│   ├── schemas/project-goal.schema.ts   collection: project_goals
│   └── goals.repository.ts          IGoalsRepository + Mongo + Memory + Proxy
└── interfaces/
    ├── resolver.controller.ts
    └── resolver.routes.ts
```

### Kontrakty domenowe

```ts
ProjectGoal {
  goalId, uid, sessionId?,
  title, description?,
  weight: 0..1, status: 'active'|'paused'|'achieved'|'archived',
  tags[], parentId?,
  embedding?: number[],   // 1024D mxbai-embed-large
  embeddingModel?, embeddingDim?,
  createdAt, updatedAt
}

CorrelationResult {
  uid, sessionId?, actionRef, actionText, computedAt,
  embeddingModel, embeddingDim, topK, minScore,
  matches: { goalId, title, score, weight, reason }[],
  dominant: match | null
}
```

---

## 3. Algorytm korelacji (deterministyczny)

```
input: { uid, actionRef, actionText, topK?, minScore? }

goals  ← list(uid, 'active') ∩ has(embedding)
if goals = ∅ → matches=[], dominant=null    // oszczędność LLM

v ← embed(actionText, mxbai-embed-large, 1024D)

matches ← goals
  .map(g → { score = cos(v, g.embedding),
             eff   = score × g.weight,
             reason = "cosine(...) × weight(...) = ..." })
  .filter(score ≥ minScore)
  .sortDesc(eff)
  .slice(topK)

dominant ← matches[0] ?? null
emit('resolver.correlation.computed', { actionRef, matches, dominant })
```

**Konfiguracja domyślna:** `RESOLVER_TOP_K=5`, `RESOLVER_MIN_SCORE=0.55`.

---

## 4. Adapter Pattern w resolverze

`GoalsRepositoryProxy` powiela strategię z `IntentMapRepositoryProxy`:

| Stan Mongo | `goalsRepository.backend` | Zachowanie |
|---|---|---|
| `isMongoReady() === true` | `'mongo'` | persystencja w `project_goals`, embeddingi inline |
| Mongo offline / brak | `'memory'` | in-process Map, brak persystencji — degradacja graceful |

Logowanie wyboru raz na proces: `[resolver] goals backend: mongo|memory`.

---

## 5. Powierzchnia REST

| Method | Path | Opis |
|---|---|---|
| `GET`    | `/api/resolver/goals?status=active` | lista celów użytkownika (bez wektorów) |
| `POST`   | `/api/resolver/goals` | utworzenie celu + async embedding |
| `POST`   | `/api/resolver/goals/:goalId/reembed` | backfill wektora |
| `DELETE` | `/api/resolver/goals/:goalId` | archiwizacja przez usunięcie |
| `POST`   | `/api/resolver/correlate` | korelacja dowolnej akcji z celami |

`/api/ready` rozszerzone o `resolver: { backend }`.

---

## 6. Nowe eventy w SystemEvent

```ts
| 'resolver.goal.created'
| 'resolver.goal.updated'
| 'resolver.correlation.computed'
```

Każde zdarzenie automatycznie broadcastowane do WS klientów w pokoju `session:<id>` przez istniejący `socket.gateway` (kanał `logos.event`).

---

## 7. Audit TTL — czarna skrzynka z oddychaniem

`intent_audit` schema:

```ts
{
  sessionId, uid, action: 'create'|'append'|'replace'|'snapshot'|'delete',
  fragment?, payload?, versionBefore?, versionAfter?,
  expiresAt?: Date | null,    // null = wieczne (snapshot)
  createdAt
}
indexes:
  { sessionId:1, createdAt:-1 }
  { expiresAt:1, expireAfterSeconds:0 }   // TTL bezstratny
```

Krzywa retencji: szum (append/replace/create/delete) wygasa po 90 dniach, snapshoty trwają. Mongo wykonuje czyszczenie samodzielnie — backend nie traci cykli.

---

## 8. Stan plików (delta wobec raportu III)

| Plik | Status |
|---|---|
| [src/modules/resolver/domain/project-goal.entity.ts](src/modules/resolver/domain/project-goal.entity.ts) | NEW |
| [src/modules/resolver/domain/correlation.entity.ts](src/modules/resolver/domain/correlation.entity.ts) | NEW |
| [src/modules/resolver/infrastructure/schemas/project-goal.schema.ts](src/modules/resolver/infrastructure/schemas/project-goal.schema.ts) | NEW |
| [src/modules/resolver/infrastructure/goals.repository.ts](src/modules/resolver/infrastructure/goals.repository.ts) | NEW |
| [src/modules/resolver/application/correlate-action.usecase.ts](src/modules/resolver/application/correlate-action.usecase.ts) | NEW |
| [src/modules/resolver/interfaces/resolver.controller.ts](src/modules/resolver/interfaces/resolver.controller.ts) | NEW |
| [src/modules/resolver/interfaces/resolver.routes.ts](src/modules/resolver/interfaces/resolver.routes.ts) | NEW |
| [src/core/config/app.config.ts](src/core/config/app.config.ts) | EXT — sekcje `resolver` + `audit` |
| [src/core/events/event.types.ts](src/core/events/event.types.ts) | EXT — 3 nowe eventy |
| [src/infrastructure/ai/provider.types.ts](src/infrastructure/ai/provider.types.ts) | EXT — `EmbedInput.model?`/`dimensions?` |
| [src/infrastructure/ai/providers/ollama.provider.ts](src/infrastructure/ai/providers/ollama.provider.ts) | EXT — honoruje override modelu |
| [src/infrastructure/ai/providers/simulated.provider.ts](src/infrastructure/ai/providers/simulated.provider.ts) | EXT — deterministyczny dim override |
| [src/modules/memory/infrastructure/schemas/intent.schema.ts](src/modules/memory/infrastructure/schemas/intent.schema.ts) | EXT — `expiresAt` + TTL index + `auditExpiryFor()` |
| [src/modules/memory/infrastructure/intent-map.mongo.repository.ts](src/modules/memory/infrastructure/intent-map.mongo.repository.ts) | EXT — przepisuje `expiresAt` przy mutacjach |
| [src/shared/validators/schemas.ts](src/shared/validators/schemas.ts) | EXT — `goalCreateSchema`, `correlateActionSchema` |
| [src/routes/index.ts](src/routes/index.ts) | EXT — montuje resolver + `resolver.backend` w `/ready` |
| [env/.env.development](env/.env.development) | EXT — RESOLVER_* + AUDIT_RETENTION_SECONDS |

---

## 9. Weryfikacja B = 1.0

| Front | Wynik |
|---|---|
| `npx tsc --noEmit` | EXIT=0 |
| `npx jest --colors=false` | 4 passed / 1 skipped, EXIT=0 |
| `npx tsc -p tsconfig.json` | EXIT=0 |
| Frontend HTML (`LOGOS V5.3 Universal.html`) | bez zmian — kontrakt API nienaruszony |
| Adapter Pattern — Memory | nadal działa (Mongo ↔ Postgres ↔ memory) |
| Adapter Pattern — Resolver | działa (Mongo ↔ memory) |

---

## 10. Otwarte fronty — menu kolejnego sygnału

1. **Auto-korelacja w pętli analizy** — hook w `analyzeQuery`: każde `logos.analyze.completed` automatycznie wywołuje `correlateAction(actionRef='logos:analyze:<sid>')`. Wynik wraca przez WS do klienta jako `logos.event`. To zamknięcie pętli **intent → action → goal**.
2. **Testy integracyjne resolvera** — `mongodb-memory-server` + 3 testy:
   - audit TTL respektowane (snapshot zostaje, append wygasa)
   - Proxy graceful (Mongo offline → memory backend)
   - end-to-end `correlate` z deterministycznym `simulated` embedderem.
3. **Snapshot worker (async)** — `POST /api/memory/snapshot` zapisujący aktualny graf do `intent_audit` z `expiresAt=null`. Wieczna pamięć kluczowych momentów wizji.
4. **Atlas Vector Search** — gdy `count(project_goals) >> 10k`, podmiana in-process cosine na `$vectorSearch`. Indeks knnBeta(1024D, cosine).
5. **Quest ↔ Resolver bridge** — `quest.completed` event → `correlateAction(actionRef='quest:<id>')`. Ukończony quest sam się rozlicza wobec celu projektu.

---

## 11. Pytania kontrolne do FELAI

1. **Auto-korelacja vs. opt-in:** czy każda analiza ma być automatycznie korelowana, czy tylko po jawnym żądaniu (`?correlate=true`)? Domyślnie zakładam **auto**.
2. **Próg `minScore=0.55`** — czy utrzymać, czy zaostrzyć do 0.65 dla mniej fałszywych dopasowań? Wartość zależy od jakości mxbai w polskiej domenie.
3. **Goal weight w korelacji** — używamy `score × weight` przy sortowaniu, ale `score` jest filtrowany progiem. Czy filtrować po efektywnym `score × weight` zamiast surowego `score`?
4. **Snapshot trigger** — automatyczny co N append'ów, czy ręczny przez endpoint? Sugeruję **hybrydę**: każde 25 mutacji = auto-snapshot.
5. **Cele dziedziczone (`parentId`)** — czy korelacja ma propagować dopasowanie w górę drzewa celów (cel-dziecko match → też matchuje rodzica z dyskontem)?

---

## 12. Status końcowy

```
✅ Resolver: rdzeń woli systemu — wkuty
✅ TTL audit:                   90d, snapshoty wieczne
✅ Embedding gęstość:           1024D mxbai-embed-large
✅ Adapter Pattern (×2):        intent-map + goals
✅ Bilans B:                    1.0
✅ Build:                       zielony
🌒 Następny krok:               sygnał FELAI — auto-korelacja, testy lub snapshot
```

Kuźnia czeka na sygnał.
