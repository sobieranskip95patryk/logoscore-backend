# 09. Backlog Fix Plan And Risks

## A) Krytyczne ryzyka (P1)
1. V4.5 bezpośrednio do Gemini z frontu.
- Ryzyko: governance, sekrety, brak audytu serwerowego.
- Naprawa: przenieść wywołania do backendowego adaptera i policy layer.

2. BRIDGE `postMessage('*')`.
- Ryzyko: możliwa iniekcja wiadomości w niekontrolowanym osadzeniu.
- Naprawa: allowlista origin + podpis komunikatu.

3. Globalny `500` dla błędów domenowych.
- Ryzyko: słaba semantyka API i gorsza diagnostyka klienta.
- Naprawa: mapowanie wyjątków domenowych na kody 4xx.

## B) Wysokie ryzyka (P2)
1. MIGI launcher i runtime path assumptions.
- Naprawa: wrapper uruchomieniowy z walidacją ścieżek i health-gating.

2. Warning open handles w testach.
- Naprawa: cleanup timers/processes/sockets w teardown.

3. Niespójne punkty dostępu API w HTML (dodatkowy `API_URL` w V5.3).
- Naprawa: pojedynczy adapter endpoint + env-driven base URL.

## C) Średnie ryzyka (P3)
1. Brak centralnej wersjonizacji kontraktu dla BRIDGE message bus.
- Naprawa: `bridge.message.v1` schema + walidacja.

2. Brak server-side snapshotu wspólnej sesji dual-panel.
- Naprawa: `bridge_state` persistence + timeline.

## D) Definition of Done dla „pełnego scalenia”
1. V4.5 i V5.3 działają przez jeden backend orchestration layer.
2. BRIDGE zarządza wspólną sesją, a nie tylko forwardingiem tekstu.
3. MIGI telemetry i EQ metryki są widoczne przez backend API.
4. Security: RBAC + ownership + audyt + policy gates.
5. Testy: unit/integration/contract + scenariusze regresji.

## E) Decyzja architektoniczna
Nie ma potrzeby budować nowego backendu od zera na tym etapie.
Obecny backend ma właściwą bazę (DDD, event bus, middleware, readiness).
Najmocniejsza ścieżka to ewolucyjna rozbudowa modułowa (co już rozpoczęto przez `migi` control-plane).
