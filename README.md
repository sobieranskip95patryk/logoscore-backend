# LogosCore — backend dla LOGOS V5.3 Universal (MTAQuestWebsideX)

> Cyfrowy kregoslup wizji. Modularny rdzen oparty na DDD, event-driven flow,
> Firebase Auth, Postgres, Redis i WebSocket realtime.

Ten backend obsluguje frontend [`LOGOS V5.3 Universal.html`](LOGOS%20V5.3%20Universal.html):
glos, drag&drop plikow i obrazow, mape intencji, synteze mowy.

---

## Kontrakt API (zgodny z frontendem HTML)

Bazowy URL: `http://localhost:3000/api`. Wszystkie endpointy wymagaja naglowka
`Authorization: Bearer <FirebaseIdToken>`. Gdy Firebase Admin nie jest skonfigurowany,
backend dziala w trybie miekkim (akceptuje token jako pseudo-uid) — przydatne do dev.

| Metoda | Sciezka                          | Opis                                                |
|--------|----------------------------------|-----------------------------------------------------|
| GET    | `/api/health`                    | Liveness + wersja                                   |
| POST   | `/api/logos/analyze`             | Analiza intencji / obrazu / dokumentu (AI)          |
| POST   | `/api/logos/synthesize`          | Synteza mowy → `audioBase64` (PCM s16le 24kHz mono) |
| GET    | `/api/memory/intent-map`         | Pobranie mapy intencji sesji                        |
| POST   | `/api/memory/intent-map/update`  | Dopisanie nowego fragmentu mapy intencji            |
| POST   | `/api/quest/start`               | Start questa                                        |
| POST   | `/api/quest/reward`              | Wyplata nagrody za questa                           |
| GET    | `/api/quest/:id`                 | Pobranie questa                                     |
| GET    | `/api/user/me`                   | Profil zalogowanego uzytkownika                     |
| GET    | `/api/inventory`                 | Lista przedmiotow uzytkownika                       |
| POST   | `/api/inventory/add`             | Dodanie przedmiotu                                  |
| DELETE | `/api/inventory/:id`             | Usuniecie przedmiotu                                |

WebSocket: `ws://localhost:3000` (Socket.IO). Klient po polaczeniu emituje
`subscribe(sessionId)`, a otrzymuje wszystkie zdarzenia EventBus jako `logos.event`.

---

## Architektura (zgodna z `instrukcja 1.md`)

```
src/
  core/                  # state-machine, event-bus, config (Firebase, app)
  modules/               # quest, user, inventory, logos, memory  (DDD)
    <module>/
      domain/            # encje + reguly
      application/       # use-cases
      infrastructure/    # repozytoria (Postgres + memory fallback)
      interfaces/        # controller + routes
  infrastructure/        # postgres, redis, websocket gateway, AI adapter
  shared/                # constants, validators (zod), dto, utils, middleware
  routes/                # rejestracja /api/*
  app.ts                 # Express + middleware
  server.ts              # HTTP + Socket.IO + bootstrap
```

Modul `logos` i `memory` zostaly dodane ponad pierwotny szkielet, bo HTML wprost
ich uzywa (`/logos/analyze`, `/logos/synthesize`, `/memory/intent-map`).

---

## Uruchomienie (dev)

```powershell
# 1. instalacja
npm install

# 2. tryb deweloperski (in-memory, bez Postgres/Redis/Firebase)
npm run dev

# 3. sprawdz
curl http://localhost:3000/api/health
```

Domyslna konfiguracja `env/.env.development`:
- `ALLOW_ANONYMOUS=true` — frontend HTML dziala bez Firebase Admin,
- brak `AI_API_KEY` — `ExecuteService` zwraca odpowiedzi symulowane (pelny pipeline gra),
- brak `DATABASE_URL` — repozytoria uzywaja pamieci procesu.

Pelny stack:

```powershell
docker compose up --build
```

---

## Tryby AI

`infrastructure/ai/execute.service.ts` ma zaimplementowanego adaptera **Gemini**
(REST). Gdy ustawisz `AI_API_KEY` i `AI_PROVIDER=gemini`:
- `analyze` → `gemini-1.5-flash` (multimodal: tekst + obraz),
- `synthesize` → `gemini-2.5-flash-preview-tts` (raw PCM 24kHz, voiceName domyslnie `Fenrir` — zgodnie z HTML).

Frontend `LOGOS V5.3 Universal.html` skleja naglowek WAV po stronie klienta —
backend zwraca surowy PCM jako `audioBase64`.

---

## Zdarzenia (EventBus)

| Nazwa                              | Emiter                       |
|------------------------------------|------------------------------|
| `system.boot` / `system.shutdown`  | `server.ts`                  |
| `logos.analyze.started/completed`  | `analyze-query.usecase`      |
| `logos.synthesize.completed`       | `synthesize-speech.usecase`  |
| `memory.intent.updated`            | `memory.controller`          |
| `quest.started/rewarded`           | `quest.usecase`              |
| `inventory.item.added/removed`     | `inventory.routes`           |
| `state.transition`                 | `state-machine/engine`       |

Kazde zdarzenie jest broadcastowane przez Socket.IO do pokoju `session:<sessionId>`
(albo globalnie, gdy brak sessionId).

---

## Skrypty npm

| Skrypt              | Opis                              |
|---------------------|-----------------------------------|
| `npm run dev`       | ts-node-dev (hot reload)          |
| `npm run build`     | `tsc` -> `dist/`                  |
| `npm start`         | `node dist/server.js`             |
| `npm run typecheck` | `tsc --noEmit`                    |
| `npm run lint`      | ESLint                            |
| `npm test`          | Jest (unit)                       |

---

## Status operacyjny

```
SYSTEM        : LogosCore
WERSJA        : 5.3.0
KOHERENCJA    : P = 1.0
ARCHITEKT     : MTAQuestWebsideX
```
