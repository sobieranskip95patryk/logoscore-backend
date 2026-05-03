# 08. Enterprise Execution Roadmap (Now -> AGI Build)

## Faza A: Stabilizacja i standaryzacja (0-2 tygodnie)
1. Ujednolicić V4.5 na backend AI gateway (bez zmiany UI/charakteru).
2. Rozszerzyć BRIDGE o signed-origin i walidację komunikatów.
3. Dodać mapowanie błędów domenowych -> właściwe statusy HTTP (409/422).
4. Zdiagnozować open handles w testach (`--detectOpenHandles`).

Kryterium wyjścia:
- zielone testy + brak krytycznych warningów runtime,
- brak bezpośrednich kluczy LLM po stronie frontu.

## Faza B: BRIDGE Core orchestration (2-6 tygodni)
1. Wprowadzić `bridgeSession` i event journal.
2. Spiąć `V4.5` i `V5.3` wspólną mapą sesji, bez utraty niezależnych paneli.
3. Dodać „conflict detection” między odpowiedziami paneli.
4. Dodać endpointy obserwowalności BRIDGE (`state`, `audit`, `timeline`).

Kryterium wyjścia:
- powtarzalna synchronizacja dual-panel,
- pełny audit trail decyzji.

## Faza C: MIGI + EQ-Bench operational merge (6-10 tygodni)
1. Uruchamiać eksperymenty MIGI z backendu (kontrolowane scenariusze).
2. Zapisać metryki EQ/Risk do struktur backendowych.
3. Publikować sygnały MIGI do EventBus i Socket.IO.
4. Zintegrować risk radar w BRIDGE Core jako dane sesyjne.

Kryterium wyjścia:
- jednolita telemetria Logos + MIGI,
- kontrolowany pipeline eksperymentalny.

## Faza D: Produkcyjna niezawodność i governance (10-16 tygodni)
1. Silniejsze policy gates (`Anti-D`, spójność odpowiedzi, odrzucanie szumu).
2. SLO/SLA, alarmowanie i playbooki incydentowe.
3. Kontrakty API versioned + testy kontraktowe frontend/backend.
4. Disaster recovery i procedury rollback.

Kryterium wyjścia:
- środowisko enterprise-ready,
- gotowość do dalszej ewolucji systemu.

## Plan pracy przy limicie tokenów (operacyjnie)
1. Priorytet 1: dokończyć scalenie backendowe V4.5 + BRIDGE state sync.
2. Priorytet 2: domknąć MIGI adapter i telemetry merge.
3. Priorytet 3: hardening + observability + test matrix.
4. Każdy etap kończyć działającym slice'em, nie teorią.
