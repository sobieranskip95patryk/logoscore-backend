# RAPORT — LogosCore Backend (LOGOS V5.3 Universal)

**Data:** 26 kwietnia 2026
**Repozytorium:** `c:\Users\patry\OneDrive\Pulpit\logoscore-backend`
**Wersja:** 5.3.0
**Status:** ✅ Operacyjny (typecheck OK, build OK, testy zielone)

---

## 1. Materiały wejściowe (analiza)

Przeanalizowane zostały trzy pliki źródłowe:

| Plik | Rola | Co z niego wzięto |
|------|------|-------------------|
| `instrukcja 1.md` | Manifest architektury | Pełna struktura folderów (DDD: core / modules / infrastructure / shared), nazwy plików, szkielet `app.ts` + `server.ts`, lista warstw modułów (domain → application → infrastructure → interfaces) |
| `README.md` (oryginalny) | Manifest filozoficzny | Mapowanie intencji, hermetyczność modułów, „lustrzane odbicie HTML”, koherencja P=1.0, modułowy podział `/core /api /database /modules` |
| `LOGOS V5.3 Universal.html` | Kontrakt frontendu | Konkretne endpointy: `BACKEND_URL = http://localhost:3000/api`, Firebase Auth (anonimowy), `/logos/analyze`, `/logos/synthesize`, `/memory/intent-map`, format `audioBase64` jako surowy PCM s16le 24 kHz mono (WAV-header składany po stronie klienta), nagłówek `Authorization: Bearer <FirebaseIdToken>` |

---

## 2. Co zbudowałem

### 2.1 Konfiguracja korzenia

- [package.json](package.json) — Express, Firebase Admin, Socket.IO, ioredis, pg, zod, helmet, ts-node-dev, jest, eslint
- [tsconfig.json](tsconfig.json) — TS 5.5, target ES2022, strict, path aliasy `@core/*`, `@modules/*`, `@infrastructure/*`, `@shared/*`
- [.gitignore](.gitignore), [.dockerignore](.dockerignore), [.eslintrc.json](.eslintrc.json), [jest.config.js](jest.config.js)

### 2.2 Docker + CI/CD + środowiska

- [docker/Dockerfile](docker/Dockerfile) (multi-stage: builder + runtime na node:20-alpine, USER node)
- [docker/Dockerfile.dev](docker/Dockerfile.dev) (hot-reload)
- [docker/nginx.conf](docker/nginx.conf) — reverse proxy `/api/`, upgrade WS dla `/socket.io/`
- [docker-compose.yml](docker-compose.yml) — backend + Postgres 16 + Redis 7
- [.github/workflows/ci.yml](.github/workflows/ci.yml) — typecheck + lint + test + build
- [.github/workflows/deploy.yml](.github/workflows/deploy.yml) — Docker buildx (gotowe do dopięcia registry)
- `env/.env.development | .env.staging | .env.production`

### 2.3 Core (rdzeń systemu)

- [src/core/config/app.config.ts](src/core/config/app.config.ts) — ładowanie `.env` po `NODE_ENV`
- [src/core/config/firebase.config.ts](src/core/config/firebase.config.ts) — Firebase Admin (Base64 lub `GOOGLE_APPLICATION_CREDENTIALS`, fallback „soft mode”)
- [src/core/events/event-bus.ts](src/core/events/event-bus.ts) — typowany EventBus na bazie `EventEmitter`, koperty `EventEnvelope` z UUID, timestamp, sessionId
- [src/core/events/event.types.ts](src/core/events/event.types.ts) — union typów `SystemEvent`
- [src/core/state-machine/engine.ts](src/core/state-machine/engine.ts) — generyczny silnik FSM emitujący `state.transition`
- [src/core/state-machine/transitions.ts](src/core/state-machine/transitions.ts) — domyślne przejścia questa
- [src/core/state-machine/state.types.ts](src/core/state-machine/state.types.ts)

### 2.4 Infrastructure

- [src/infrastructure/database/postgres.ts](src/infrastructure/database/postgres.ts) — pool `pg`, `ensureSchema()` tworzy tabele `intent_maps`, `quests`, `users`, `inventory_items`
- [src/infrastructure/database/redis.ts](src/infrastructure/database/redis.ts) — `ioredis` z lazy connect
- [src/infrastructure/websocket/socket.gateway.ts](src/infrastructure/websocket/socket.gateway.ts) — Socket.IO; subskrypcja `*` z EventBus → broadcast do `session:<sessionId>`
- [src/infrastructure/ai/execute.service.ts](src/infrastructure/ai/execute.service.ts) — adapter Gemini REST (analyze + TTS) + tryb symulacji (gdy brak `AI_API_KEY`)

### 2.5 Shared

- [src/shared/middleware/auth.middleware.ts](src/shared/middleware/auth.middleware.ts) — Bearer Firebase ID Token z trybem miękkim
- [src/shared/middleware/validate.middleware.ts](src/shared/middleware/validate.middleware.ts) — Zod
- [src/shared/middleware/error.middleware.ts](src/shared/middleware/error.middleware.ts)
- [src/shared/validators/schemas.ts](src/shared/validators/schemas.ts), [src/shared/dto/index.ts](src/shared/dto/index.ts), [src/shared/constants/index.ts](src/shared/constants/index.ts), [src/shared/utils/index.ts](src/shared/utils/index.ts)

### 2.6 Moduły domenowe

| Moduł | Encje / reguły | Use-cases | Endpointy |
|-------|----------------|-----------|-----------|
| `logos` | — (delegacja do AI) | `analyze-query`, `synthesize-speech` | `POST /api/logos/analyze`, `POST /api/logos/synthesize` |
| `memory` | `IntentMap` | repo z fallbackiem in-memory | `GET /api/memory/intent-map`, `POST /api/memory/intent-map/update` |
| `quest` | `QuestEntity`, `questRules` (FSM) | `start-quest`, `reward-quest` | `POST /api/quest/start`, `POST /api/quest/reward`, `GET /api/quest/:id` |
| `user` | `UserEntity` | upsert / ensure | `GET /api/user/me` |
| `inventory` | `InventoryItemEntity` | repo | `GET /api/inventory`, `POST /api/inventory/add`, `DELETE /api/inventory/:id` |

> **Decyzja architektoniczna:** moduły `logos` i `memory` zostały dodane ponad pierwotny szkielet z `instrukcja 1.md`, ponieważ frontend HTML wprost ich używa. Bez nich repo nie spełnia kontraktu UI.

### 2.7 Bootstrap

- [src/routes/index.ts](src/routes/index.ts) — rejestracja `/api/health` + wszystkich routerów
- [src/app.ts](src/app.ts) — Express + Helmet + CORS + body-parser + Firebase + EventBus + errorHandler
- [src/server.ts](src/server.ts) — HTTP + Socket.IO + ping Postgres/Redis + `ensureSchema` + graceful shutdown (`SIGINT`/`SIGTERM`)

### 2.8 Testy

- [tests/unit/event-bus.test.ts](tests/unit/event-bus.test.ts) — publish + subscribe
- [tests/unit/quest.rules.test.ts](tests/unit/quest.rules.test.ts) — przejścia FSM, reguła nagrody
- [tests/integration/health.test.ts](tests/integration/health.test.ts) — szkielet (skip)

---

## 3. Wykonane operacje

| Krok | Komenda | Wynik |
|------|---------|-------|
| Instalacja zależności | `npm install` | 464 pakietów, OK |
| Typecheck | `npx tsc --noEmit` | 0 błędów |
| Testy | `npx jest` | **4 passed**, 1 skipped |
| Build produkcyjny | `npx tsc -p tsconfig.json` | `dist/server.js` powstał |

---

## 4. Mapa kontraktów Frontend ↔ Backend

| Co robi UI (HTML) | Co woła | Co backend zwraca |
|-------------------|---------|-------------------|
| Anonimowe logowanie Firebase | `signInAnonymously` (klient) | Backend weryfikuje `Bearer` ID token (lub akceptuje w „soft mode”) |
| Hydratacja mapy intencji przy starcie | `GET /api/memory/intent-map?sessionId=…` | `{ sessionId, map, updatedAt }` |
| Zapytanie głosowe / drag&drop pliku/obrazu | `POST /api/logos/analyze` z `{query, sessionId, imageData?, imageMimeType?}` | `{ text, provider, model }` |
| Po długim queries — dopisanie intencji | `POST /api/memory/intent-map/update` | `{ ok, map, updatedAt }` |
| Synteza mowy | `POST /api/logos/synthesize` z `{text, sessionId, voiceName: "Fenrir"}` | `{ audioBase64, mimeType, provider }` (raw PCM, frontend skleja WAV) |

---

## 5. Tryby fallback (zero-config)

| Brakujący zasób | Zachowanie |
|-----------------|------------|
| `AI_API_KEY` | `ExecuteService` zwraca symulowany tekst i 0,5 s ciszy w PCM — pełny pipeline UI działa |
| `DATABASE_URL` | Repozytoria używają `Map` w pamięci procesu |
| Firebase Admin (brak credentiali) | Auth middleware akceptuje token jako pseudo-uid (gdy `ALLOW_ANONYMOUS=true`) |
| `REDIS_URL` | Pomijany; ostrzeżenie w logu |

To znaczy, że można uruchomić **`npm run dev`** i otworzyć HTML — wszystko gra bez żadnej konfiguracji.

---

## 6. Status operacyjny

```
SYSTEM        : LogosCore
WERSJA        : 5.3.0
ŚRODOWISKO    : development (domyślne)
PORT          : 3000
KOHERENCJA    : P = 1.0
WARSTWY       : core | modules(5) | infrastructure | shared
ZDARZENIA     : 11 typów na EventBus
ENDPOINTY     : 12 (REST) + 1 kanał WS
TESTY         : 4 passed
BUILD         : dist/server.js OK
```

---

## 7. Pytania o rozwinięcie projektu

Żeby pchnąć system z fundamentu w pełną operacyjność, potrzebuję kierunku w kilku kluczowych obszarach. Każde z pytań realnie zmienia kształt kolejnego sprintu.

### 7.1 AI / „organ percepcji”

1. **Dostawca AI** — zostajemy przy Gemini (`gemini-1.5-flash` + `gemini-2.5-flash-preview-tts`) czy dorzucić adapter OpenAI / Anthropic / lokalny LLM (Ollama)?
2. **Streaming** — czy `/logos/analyze` ma obsługiwać Server-Sent Events / WebSocket streaming tokenów (głos LOGOSa „mówi w trakcie myślenia”), czy zostawiamy odpowiedź jednorazową?
3. **System prompt** — instrukcja systemowa „bezlitośnie spójny analityk wizji” jest wpisana w kod. Wynieść do bazy danych jako edytowalny artefakt (per-sesja / per-użytkownik)?
4. **Multimodalność** — backend przyjmuje obrazy. Dodać audio (transkrypcja) i pliki binarne (PDF, .docx) z parserem?
5. **Cache odpowiedzi** — ten sam `query` + `intentMap` daje deterministyczne wyniki w dev. Cachować w Redis (TTL)?

### 7.2 Mapa intencji (memory)

6. **Format** — obecnie konkatenowany string `A -> B -> C`. Przerzucić na strukturalny graf (węzły + krawędzie + wagi) i zwracać do UI wizualizację?
7. **Wektory / RAG** — embeddingi fragmentów intencji w pgvector, żeby `analyze` dostawał najbardziej relewantny kontekst zamiast całej historii?
8. **Wersjonowanie** — historia mapy intencji (snapshoty + diff) z możliwością „cofania" do wcześniejszego stanu wizji?
9. **Wygasanie** — TTL na sesję czy persystencja na zawsze (per-uid, nie per-sessionId)?

### 7.3 Domena gier (quest / user / inventory)

10. **State-machine questów** — czy zostawiamy jedno proste przejście (IDLE → IN_PROGRESS → COMPLETED → REWARDED), czy potrzebne są podzadania, drzewa, łańcuchy?
11. **Ekonomia** — `inventory` ma `quantity` i `metadata`, ale nie ma reguł (rarity, stacking, equipment slots). Wbudować silnik ekonomii?
12. **PvP / współdzielony stan** — czy questy są tylko per-user, czy dorzucamy gildie / rankingi / handel?
13. **Generator questów z LOGOS** — czy `/logos/analyze` powinien móc *materializować* questy (LLM zwraca strukturalny JSON, backend tworzy encję)?

### 7.4 Auth & użytkownicy

14. **Migracja anonimowy → konto** — zachować mapę intencji i ekwipunek przy linkowaniu konta Google/email w Firebase?
15. **Role i uprawnienia** — admin / moderator / gracz? RBAC (np. casbin) czy hard-coded checks?
16. **Rate-limiting** — który endpoint chronimy najpierw (`/logos/analyze` najdroższy)? `express-rate-limit` w Redis czy nginx?

### 7.5 Persystencja i operacje

17. **Migracje SQL** — wprowadzić `node-pg-migrate` / `drizzle-kit` / `prisma`, czy zostać przy idempotentnym `ensureSchema()`?
18. **Observability** — dodać `pino` + structured logs + OpenTelemetry (Jaeger) + metryki Prometheus + healthcheck `/api/ready` (głęboki)?
19. **Backupy** — strategia dla Postgres (pg_dump cron) i Redis (RDB)?

### 7.6 Realtime

20. **Socket.IO vs natywny WebSocket** — Socket.IO zjada więcej, ale ma rooms/rekonekt. Zostawiamy?
21. **Prezencja** — tracking online/offline w Redis Pub/Sub?
22. **Wzorzec** — broadcast wszystkich eventów do sesji (obecnie) czy filtrowanie po typach (UI subskrybuje wybrane kanały)?

### 7.7 Frontend ↔ Backend

23. **CORS w prod** — pełna lista domen, czy maskujemy backend za nginx i CORS = same-origin?
24. **HTML jako single-file vs build pipeline** — czy planujesz rozbicie `LOGOS V5.3 Universal.html` na osobny projekt frontendowy (Vite/Next), czy ma zostać monolitycznym artefaktem?
25. **Asset pipeline dla audio** — backend mógłby zwracać już WAV/Opus zamiast surowego PCM (mniejsza odpowiedzialność klienta).

### 7.8 Bezpieczeństwo

26. **Sekrety** — zostajemy przy `.env`, czy wprowadzamy SOPS / Doppler / GCP Secret Manager?
27. **Walidacja `imageData`** — limit rozmiaru, sprawdzanie magic-bytes, antywirus (clamav) dla plików tekstowych?
28. **Audit log** — każda zmiana mapy intencji + każda nagroda zapisywane do tabeli `audit_events`?

### 7.9 Roadmap operacyjna

29. **MVP cut** — który podzbiór modułów uważasz za „v1.0 do publikacji”? (Sugestia: `logos` + `memory` + `auth`. Quest/inventory v1.1.)
30. **Hosting docelowy** — Cloud Run / Fly.io / VPS z docker-compose / Kubernetes?
31. **Domena i TLS** — masz już domenę dla `mtaquestwebsidex.app`, czy generujemy konfigurację Caddy / Let's Encrypt?

---

## 8. Sugerowany następny krok (gdybyśmy nie czekali na decyzje)

Bez dodatkowych pytań naturalna kontynuacja to:

1. **Dodać pgvector + embeddingi** dla `intent_maps` — to natychmiast podnosi jakość odpowiedzi LOGOSa.
2. **Streaming SSE w `/logos/analyze`** — subiektywnie najbardziej „magiczny” efekt UI.
3. **Skleić CI z deployem** na Cloud Run lub Fly.io (jeden workflow, jeden secret).

Wskaż priorytety z sekcji 7 — wezmę się za realizację.
