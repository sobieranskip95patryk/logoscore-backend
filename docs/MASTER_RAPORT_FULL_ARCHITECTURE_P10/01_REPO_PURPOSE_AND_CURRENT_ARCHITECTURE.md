# 01. Repo Purpose And Current Architecture

## 1) Przeznaczenie repozytorium
`logoscore-backend` jest backendem systemu LogosCore (v5.3) dla interfejsów LOGOS.
Rdzeń dostarcza:
- API HTTP (`/api/*`) dla analizy, syntezy mowy, pamięci intencji, questów i resolvera celów,
- komunikację realtime Socket.IO,
- model DDD + EventBus + state machine,
- warstwy bezpieczeństwa (auth, RBAC, ownership, rate-limit),
- observability (`/api/health`, `/api/ready`, telemetry wrappers),
- wielomagazynowość: Postgres, Mongo, Redis + fallback in-memory.

## 2) Architektura kodu (stan obecny)

### Core
- `src/core/config/*` – konfiguracja środowiska, Firebase init.
- `src/core/events/*` – EventBus i kontrakty zdarzeń.
- `src/core/state-machine/*` – lekki silnik przejść stanu.

### Infrastructure
- `src/infrastructure/database/*` – Postgres/Mongo/Redis connect + ping.
- `src/infrastructure/ai/*` – provider abstraction (Gemini/Ollama/Simulated).
- `src/infrastructure/ai/economizer/*` – cache i dedup (LRU + Redis + Mongo).
- `src/infrastructure/websocket/*` – gateway Socket.IO + auth.
- `src/infrastructure/observability/*` – NoOp/OTel tracer i histogram latencji.

### Modules
- `logos` – analiza i synteza mowy.
- `memory` – intent map/graph, ingest dokumentów, wyszukiwarka embeddingów.
- `quest` – cykl życia questów + branchowanie.
- `resolver` – korelacja działań z celami projektowymi (embedding + polarity).
- `inventory`, `user`, `security` – warstwa domenowo-użytkowa i audyt.
- `migi` – nowy moduł control-plane integracji MIGI_7G (wdrożony w tej sesji).

### Routing
- `src/routes/index.ts` centralnie rejestruje trasy.
- Readiness (`/api/ready`) sonduje Postgres/Mongo/Redis.

## 3) Kontrakt backendu względem frontendów
- `LOGOS V5.3 Universal.html` – używa backendu (`/memory/*`, `/logos/*`).
- `LOGOS V4.5 Luxe Edition.html` – obecnie używa bezpośrednio Gemini API w przeglądarce (nie backend).
- `BRIDGE_OS.html` – scala oba fronty przez `postMessage` (`BRIDGE_COMMAND`, `VOICE_INPUT_*`).

## 4) Najważniejsze stwierdzenia architektoniczne
- System backendowy jest gotowy do roli centralnego punktu synchronizacji.
- Największa niespójność: V4.5 omija backend i bezpieczeństwo serwerowe.
- BRIDGE istnieje i działa, ale wymaga rozszerzenia o warstwę orchestration i obserwowalność sesji.
- Dodany moduł `migi` umożliwia bezpieczne sterowanie procesami MIGI z backendu (admin-only).
