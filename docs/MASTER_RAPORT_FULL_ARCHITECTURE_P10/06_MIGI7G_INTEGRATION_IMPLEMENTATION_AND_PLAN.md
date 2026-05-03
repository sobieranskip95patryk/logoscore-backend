# 06. MIGI_7G Integration: Implemented + Next Plan

## 1) Co wdrożono teraz (etap 1)
W backendzie `logoscore-backend` dodano moduł integracyjny `MIGI Control Plane`.

### Nowe elementy kodu
- `src/modules/migi/application/migi.control-plane.ts`
- `src/modules/migi/interfaces/migi.routes.ts`
- podpięcie w `src/routes/index.ts` pod `/api/admin/migi/*`
- konfiguracja w `src/core/config/app.config.ts` (`migi.*`)

### Endpointy admin
- `GET /api/admin/migi/status`
- `POST /api/admin/migi/start`
- `POST /api/admin/migi/stop`
- `POST /api/admin/migi/restart`

### Bezpieczeństwo
- endpointy są chronione przez:
  - `firebaseAuthMiddleware`
  - `requireRole('admin')`

### Co uruchamia control-plane
- proces `health.py` (Flask health API) z portem konfigurowalnym,
- proces `telemetry_ws.py` (MIGI telemetry websocket).

## 2) Jak to łączy się z repo MIGI
Repo MIGI zostało pobrane do:
- `external/MIGI_7G-Dashboard-Kalibracyjny-EQ-Bench-3-Integration`

Wykryte kluczowe interfejsy MIGI:
- HTTP health/readiness/metrics (`health.py`)
- telemetry stream ws (`telemetry_ws.py`)
- dashboard UI (`memory/neurosemantics/dashboard.html`)
- EQ adapter (`eqbench_integration/migi_eqbench_adapter.py`)

## 3) Etap 2 (najbliższy)
1. Dodać reverse proxy w backendzie dla MIGI health/metrics.
2. Dodać bridge endpoint do dostarczania linku dashboard + stanu telemetrii.
3. Dodać zapis audytowy start/stop/restart MIGI do `security_audit`.
4. Dodać testy integracyjne admin flow (`start -> status -> stop`).

## 4) Etap 3 (scalenie funkcjonalne AGI pipeline)
1. Adapter `migi-eq` po stronie Node:
- uruchamianie scenariuszy EQ,
- zapis wyników w domenie `security`/`resolver`.
2. Wpięcie sygnałów MIGI do EventBus:
- `migi.health.updated`
- `migi.risk.updated`
- `migi.experiment.started/completed`
3. Synchronizacja BRIDGE z MIGI:
- komendy eksperymentalne z BRIDGE Core,
- projekcja risk radar do stanu sesji użytkownika.

## 5) Wymagane zmienne środowiskowe
- `MIGI_ENABLED=true`
- `MIGI_REPO_DIR=external/MIGI_7G-Dashboard-Kalibracyjny-EQ-Bench-3-Integration`
- `MIGI_PYTHON_CMD=python`
- `MIGI_HEALTH_PORT=18080`
- `MIGI_TELEMETRY_PORT=8765`
