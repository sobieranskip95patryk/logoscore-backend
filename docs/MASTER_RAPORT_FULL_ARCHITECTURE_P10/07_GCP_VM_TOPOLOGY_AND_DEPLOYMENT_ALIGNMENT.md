# 07. GCP VM Topology And Deployment Alignment

## 1) Otrzymany kontekst infrastruktury
Projekt:
- `TurboProject`
- `project_id: gen-lang-client-0563856780`

Compute Engine:
- instance: `logos-monolith`
- zone: `europe-central2-a`
- machine: `n2-standard-2` (2 vCPU, 8 GB)
- external IP: `34.118.79.250`

Sieć / zapory (istotne):
- allow tcp:8080
- allow tcp:80,443
- allow tcp:22

## 2) Dopasowanie do backendu LogosCore
- backend używa `PORT` (domyślnie 8080) – zgodne z regułami VM,
- `/api/health` i `/api/ready` już gotowe pod probing,
- MIGI health domyślnie przeniesiono na osobny port (`MIGI_HEALTH_PORT=18080`) aby nie kolidować z backendem.

## 3) Rekomendacja topologii runtime (bez naruszania obecnej pracy)
1. `logoscore-backend` jako główna aplikacja na `:8080`.
2. MIGI health jako side-process na `:18080`.
3. MIGI telemetry ws na `:8765`.
4. BRIDGE/UI kierować ruch wyłącznie przez backend API i jawne endpointy kontrolne.

## 4) Polityka bezpieczeństwa dla tego układu
1. Endpointy `/api/admin/migi/*` tylko rola admin.
2. W przyszłym etapie dodać allowlist IP lub dodatkowy token operacyjny dla start/stop.
3. Utrzymać brak ekspozycji kluczy LLM po stronie frontów.

## 5) Decyzje wdrożeniowe
- Nie wykonywano deployów, zmian IAM, firewall, DNS ani usług billing.
- Wdrożono jedynie kod i plan integracji w repo lokalnym.
