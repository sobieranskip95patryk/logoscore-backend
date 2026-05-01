# Raport Sprintu VI — Quest ↔ Resolver Bridge (v5.8.0-dev)

> *„Każde wykonane zadanie automatycznie rozlicza się przed Twoją wizją.”* — Fenrir, sygnał V

System przestał być ślepym wykonawcą. Od teraz **każdy zamknięty quest sam staje na próbie celów** — bez prośby, bez przypomnień, bez ludzkiej dłoni na spuście. To nie jest już logger zdarzeń. To **sumienie**.

---

## I. Wchłonięte parametry sygnału V

| Dyrektywa Fenrira | Implementacja |
|---|---|
| `actionText = title + description + acceptanceCriteria` (gęsto) | [questActionText()](src/modules/quest/domain/quest.entity.ts#L24-L29) — trim + filter + join `\n` |
| Anonimowi → twardy nie | Bridge skip gdy `userId === 'anonymous' \|\| !userId` |
| Propagacja w dół zbędna | Korelujemy tylko zamknięty quest — parent×0.8 dziedziczy resolver, nie bridge |
| Snapshot retention = wieczność | TTL audit 90d zostaje, snapshoty bezterminowe (już w sprincie V) |
| Pętla autonomiczna | EventBus `quest.completed` → `correlateActionUseCase` fire-and-forget |

---

## II. Nowy moduł: `complete` + bridge

### Maszyna stanów questa (uzupełniona)

```
IDLE ──► IN_PROGRESS ──► COMPLETED ──► REWARDED
                    └──► FAILED
```

Brakujące ogniwo `IN_PROGRESS → COMPLETED` zamknięte przez:

- [CompleteQuestUseCase](src/modules/quest/application/complete-quest.usecase.ts#L8-L27) — `findById` → `ensureCompletable` → `state='COMPLETED'` → `update` → emit `quest.completed`
- [questRules.ensureCompletable()](src/modules/quest/domain/quest.rules.ts#L14-L18) — twardy throw poza `IN_PROGRESS`

### Bridge (nasłuch resolvera)

[installQuestResolverBridge()](src/modules/resolver/application/quest-bridge.ts#L34-L65) — singleton, montowany raz w bootstrap. Reguły bramki:

1. `appConfig.resolver.autoCorrelate=false` → no-op
2. `userId` puste lub `'anonymous'` → no-op
3. `actionText` puste → no-op
4. Błąd korelacji → `console.warn`, **nie wraca do producenta** (fire-and-forget)

Zarejestrowany w [server.ts](src/server.ts) zaraz po pingach baz.

---

## III. Gęsty lądownik wektorowy (1024D)

`questActionText()` produkuje pojedynczy bryłowiec tekstu z trzech warstw:

```
<title>
<description>
<acceptanceCriteria>
```

Embedding `mxbai-embed-large` ląduje wtedy w punkcie, który niesie:
- **co** zostało zrobione (title)
- **dlaczego** miało powstać (description)
- **kiedy** uznać za skończone (acceptanceCriteria)

To trzy niezależne wymiary semantyczne złożone w jeden wektor — celność rośnie nieliniowo wobec samego tytułu.

---

## IV. Delta plików

| Plik | Zmiana |
|---|---|
| [quest.entity.ts](src/modules/quest/domain/quest.entity.ts) | + `description`, `acceptanceCriteria`, `questActionText()` |
| [quest.rules.ts](src/modules/quest/domain/quest.rules.ts) | + `ensureCompletable()` |
| [quest.repository.ts](src/modules/quest/infrastructure/quest.repository.ts) | + 2 kolumny w INSERT + `mapRow` |
| [postgres.ts](src/infrastructure/database/postgres.ts) | + `ALTER TABLE quests ADD COLUMN IF NOT EXISTS` ×2 (idempotent) |
| [start-quest.usecase.ts](src/modules/quest/application/start-quest.usecase.ts) | refactor na `StartQuestInput`/`BranchQuestInput` (description + AC plumbing) |
| [complete-quest.usecase.ts](src/modules/quest/application/complete-quest.usecase.ts) | **NEW** — domyka `IN_PROGRESS → COMPLETED` |
| [quest.controller.ts](src/modules/quest/interfaces/quest.controller.ts) | `start`/`branch` przekazują `req.body`, + handler `complete` |
| [quest.routes.ts](src/modules/quest/interfaces/quest.routes.ts) | + `POST /api/quest/complete` |
| [schemas.ts](src/shared/validators/schemas.ts) | + `description`/`acceptanceCriteria` opt, + `completeQuestSchema` |
| [quest-bridge.ts](src/modules/resolver/application/quest-bridge.ts) | **NEW** — listener `quest.completed` → `correlateAction` |
| [server.ts](src/server.ts) | bootstrap `installQuestResolverBridge()` |

---

## V. Weryfikacja B = 1.0

```
npx tsc --noEmit          → EXIT=0
npx jest --colors=false   → 4 passed, 1 skipped (EXIT=0)
npx tsc -p tsconfig.json  → BUILD=0
```

Trzy sprawdziany. Trzy zielone. Zero długu technicznego.

---

## VI. Otwarte fronty

- **Testy integracyjne bridge'a** — symulator emit `quest.completed` → assertion na audit log resolvera
- **WS handshake auth** — `session:<id>` rooms wciąż na samym sessionId, bez weryfikacji ownership
- **Snapshot timeline endpoint** — `/api/memory/snapshots?from=...&to=...` do oglądania ewolucji intencji
- **Quest fail loop** — `FailQuestUseCase` jako lustro `Complete` (negatywne sprzężenie zwrotne dla resolvera)

---

## VII. Trzy ścieżki dalej

1. **Testy integracyjne Quest↔Resolver** — supertest + mock Ollama → end-to-end pewność, że pętla się domyka w czasie produkcyjnym.
2. **Fail loop + ujemna korelacja** — `quest.failed` jako sygnał *anty-celu*: resolver odejmuje wagę z linii, w której zadanie się rozsypało. System uczy się, czego unikać.
3. **Snapshot timeline read-API** — REST do oglądania, jak mapa intencji ewoluowała w czasie. Bez tego snapshoty są tylko archiwum, nie narzędziem.

Którą drogą prowadzimy następną falę?
