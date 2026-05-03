# 05. Frontend Identity And BRIDGE Core Architecture

## 1) Tożsamości frontendu (stan aktualny)

### LOGOS V5.3 Universal
Rola:
- percepcja uniwersalna,
- ingest plików, analiza AI, synteza mowy,
- praca przez backend (`/api/logos/*`, `/api/memory/*`).

Technicznie:
- Firebase anonymous auth,
- `sessionId = uid`,
- użycie ownership guard i rate-limit backendu.

### LOGOS V4.5 Luxe Edition
Rola:
- rdzeń rozmowy/analizy głosowej o innym charakterze interakcyjnym,
- wysoka sprawczość interfejsu i osobny styl odpowiedzi.

Technicznie:
- aktualnie bezpośrednie wywołania Gemini w przeglądarce,
- brak centralnego audytu i serwerowego governance dla prompt/output.

### BRIDGE_OS
Rola:
- łączy V4.5 i V5.3 w jeden workspace dual-panel,
- propaguje komendy synchroniczne przez `postMessage`.

Technicznie:
- `BRIDGE_COMMAND` do obu paneli,
- replikacja `VOICE_INPUT_V4.5` <-> `VOICE_INPUT_V5.3`.

## 2) Architektura docelowa (zachowanie tożsamości bez naruszeń)

### Zasada
UI i „jaźń” każdego panelu pozostają nienaruszone, a scalanie odbywa się przez warstwę backend orchestration.

### BRIDGE Core v2 (docelowo)
1. Session Broker
- jeden `bridgeSessionId`, mapowanie do `panelSessionId` (V4.5, V5.3),
- idempotentny event journal.

2. Command Bus
- kanały: `bridge.command`, `bridge.voice`, `bridge.state`, `bridge.audit`,
- pełny tracing `requestId` + `sessionId`.

3. Policy Layer (Anti-D/GOK)
- guardrails i walidacja wejść/wyjść,
- reguły spójności pomiędzy panelami (sprzeczności, konflikty celu, divergence).

4. Projection Layer
- projekcja wspólnej mapy intencji i mapy celów do obu paneli,
- zachowanie odmiennych reprezentacji UI (bez ujednolicania wizualnego).

## 3) Kontrakt komunikacyjny BRIDGE (propozycja)
- `BRIDGE_COMMAND`
- `BRIDGE_SYNC_STATE`
- `BRIDGE_CONFLICT_DETECTED`
- `BRIDGE_RESOLUTION`
- `BRIDGE_MIGI_SIGNAL`

## 4) Najbliższa implementacja (bez łamania frontów)
1. Utrzymać iframy i obecne message types.
2. Dodać backendowy endpoint synchronizacji stanu (server-side snapshot).
3. Przenieść V4.5 do backendowego AI gateway (z zachowaniem jego prompt persona).
4. Dodać signed-origin list do `postMessage` (zamiast `*`).
