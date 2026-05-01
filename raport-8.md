# RAPORT VIII — Protokół Fortyfikacji LOGOS

> *„Otwarta brama bez strażnika to nie świątynia — to ruina, w której echo wciąż udaje liturgię."*
> Sprint VIII · Security & Auth Hardening · v6.0.0-rc1
> Skierowane do: **FELAI · Fenrir · Architekt Strażnic**

---

## I. Wchłonięte parametry dyrektywy

Z dyrektywy Fenrira wyciągnąłem cztery wektory ognia:

1. **WS handshake Firebase** — żaden socket nie wstaje bez weryfikacji tożsamości; anonim wpuszczany tylko gdy `ALLOW_ANONYMOUS=true` i tylko do swojego pokoju.
2. **RBAC** — trzy role (`admin` / `user` / `system`), pole `role` w `req.user` rozstrzygane z claims Firebase **albo** allowlisty `ADMIN_UIDS`.
3. **RODO + Audit** — eksport i kasowanie konta jako pierwszorzędne endpointy (`/api/me/export`, `DELETE /api/me`); kolekcja `security_audit` z TTL na operacjach technicznych i wieczystą retencją na akcjach RODO.
4. **Cloud Armor-ready rate limiting** — `express-rate-limit@7` jako warstwa lokalna, key per-uid, komentarz w kodzie wskazujący Redis store dla `min-instances>1`.

Plus dwa wektory uzupełniające, które dyktuje sama dyscyplina prod:

5. **Production safety guard** — `createApp()` rzuca FATAL, jeśli `NODE_ENV=production` i `ALLOW_ANONYMOUS=true` bez świadomego override, lub `CORS_ORIGIN=*`.
6. **Ownership middleware** — wszystkie endpointy `quest`, `memory`, `logos` wymuszają, że identyfikator zasobu w request === `req.user.uid` (admin/system bypass).

---

## II. WS handshake auth + role w pokojach

Plik: [src/shared/middleware/socket-auth.middleware.ts](src/shared/middleware/socket-auth.middleware.ts)

```
io.use(socketAuthMiddleware)
  → token z handshake.auth.token | Authorization: Bearer
  → admin Firebase verifyIdToken (soft-mode: uid = token.slice(0,64))
  → fallback ALLOW_ANONYMOUS=true → SocketUser anonim
  → odrzut: socket.disconnect + audit auth.failure
```

`canJoinRoom(user, sessionId)` — funkcja czysta, deterministyczna, testowalna:
- `admin` / `system` → zawsze `true`
- `user` (też anonim) → `sessionId === uid` lub `sessionId.startsWith(uid + ':')`
- `undefined` user lub puste sessionId → `false`

Gateway w [src/infrastructure/websocket/socket.gateway.ts](src/infrastructure/websocket/socket.gateway.ts) waliduje pokoje na `subscribe` i `logos.stream`. uid zawsze brany z `socket.data.user`, **nigdy** z payloadu klienta — to zamyka klasyczny wektor podszywania się pod cudzą sesję.

---

## III. RBAC + Ownership

**RBAC** ([src/shared/middleware/rbac.middleware.ts](src/shared/middleware/rbac.middleware.ts)):
- `requireRole(...allowed)` — 401 gdy brak `req.user`, 403 gdy rola spoza listy.
- `requireAuthenticated` — odcina anonimów (RODO i admin endpoints).
- Rola rozstrzygana w [src/shared/middleware/auth.middleware.ts](src/shared/middleware/auth.middleware.ts) przez `resolveRole(uid, anonymous, claimRole)`: `claim.role === 'admin'` LUB `appConfig.auth.adminUids.includes(uid)` → `'admin'`. Anonim zawsze `'user'`.

**Ownership** ([src/shared/middleware/ownership.middleware.ts](src/shared/middleware/ownership.middleware.ts)):
- `requireOwnership('body'|'query'|'params', field)` — admin/system bypass, brak pola → `next()` (semantyka: kontroler użyje `req.user.uid` jako fallback), mismatch → 403 `forbidden_ownership`.
- Quest dodatkowo ma własny `assertQuestOwnership(req, questId)` w kontrolerze ([src/modules/quest/interfaces/quest.controller.ts](src/modules/quest/interfaces/quest.controller.ts)), bo ownership trzeba odczytać z DB po questId — middleware nie wystarczy.
- Memory: wszystkie endpointy `intent-map`, `snapshots` mają guard po `sessionId`.
- Logos: `/analyze` i `/synthesize` po `sessionId`.

---

## IV. Rate-limit + Production Guard

**Rate limit** ([src/shared/middleware/rate-limit.middleware.ts](src/shared/middleware/rate-limit.middleware.ts)):

| limiter | window | max | scope |
|---|---|---|---|
| `globalRateLimit` | 60 s | 120 req | wszystkie `/api/*` (ale po `/health` i `/ready`) |
| `aiRateLimit` | 60 s | 20 req | `/api/logos/*` i `/api/memory/ingest|search` |

Key generator: `req.user?.uid ?? req.ip` — to zamyka klasyczny problem z N anonimami za jednym NAT-em (każdy ma własny ip, każdy zalogowany ma własny uid).

`RATE_LIMIT_ENABLED=false` → middleware zwraca no-op (testy lokalne nie cierpią). Komentarz w kodzie: *„dla Cloud Run min-instances>1 podłącz Redis store, w przeciwnym razie limity są per-instance"*.

**Production guard** ([src/app.ts](src/app.ts)):

```ts
function assertProductionSafety(): void {
  if (NODE_ENV !== 'production') return;
  if (ALLOW_ANONYMOUS && SECURITY_OVERRIDE !== 'allow_anonymous_in_prod') {
    throw new Error('FATAL: ALLOW_ANONYMOUS=true is forbidden in production');
  }
  if (CORS_ORIGIN === '*') {
    throw new Error('FATAL: CORS_ORIGIN=* is forbidden in production');
  }
}
```

Plus `app.set('trust proxy', 1)` (wymóg Cloud Run za LB) i `bodyLimit` z konfigu (default `12mb` — zostawia margines na multimodal payloady, ale zamyka DoS przez 1GB JSON).

---

## V. RODO + Security Audit

**Endpointy** ([src/modules/security/interfaces/security.routes.ts](src/modules/security/interfaces/security.routes.ts)):

| metoda | ścieżka | guard | efekt |
|---|---|---|---|
| `GET` | `/api/me/export` | `requireAuthenticated` | JSON dump wszystkich danych usera (Content-Disposition: attachment) + audit `user.exported` (eternal) |
| `DELETE` | `/api/me` | `requireAuthenticated` | Cascade purge: quests → inventory → goals → intentMap → profile (FK-safe) + audit `user.deleted` (eternal) |
| `GET` | `/api/admin/security/audit` | `requireRole('admin')` | Lista zdarzeń z filtrami `uid`, `action`, `from`, `to`, `limit≤1000` |

**GDPR Service** ([src/modules/security/application/gdpr.service.ts](src/modules/security/application/gdpr.service.ts)):
- `exportUser(uid)` — `Promise.all([profile, quests, inventory, goals, intentMap, intentSnapshots])`
- `purgeUser(uid)` — sekwencja `[quests, inventory, goals, intentMap]` → `[profile]`, zwraca `PurgeReport` z licznikami.

**Audit log** ([src/modules/security/infrastructure/security-audit.repository.ts](src/modules/security/infrastructure/security-audit.repository.ts)):
- Akcje: `auth.success`, `auth.failure`, `rate_limited`, `forbidden`, `user.exported`, `user.deleted`.
- Akcje RODO (`user.exported`, `user.deleted`) → `expiresAt = null` (wieczyste, dowód compliance).
- Reszta → TTL `audit.retentionSeconds` (default 90 dni).
- Graceful degradation: jeśli Mongo offline → `console.warn` + no-op. Linia obrony nie blokuje aplikacji.

---

## VI. Delta plików (Sprint VIII)

**Nowe (10):**

- [src/shared/middleware/rbac.middleware.ts](src/shared/middleware/rbac.middleware.ts)
- [src/shared/middleware/ownership.middleware.ts](src/shared/middleware/ownership.middleware.ts)
- [src/shared/middleware/rate-limit.middleware.ts](src/shared/middleware/rate-limit.middleware.ts)
- [src/shared/middleware/socket-auth.middleware.ts](src/shared/middleware/socket-auth.middleware.ts)
- [src/modules/security/infrastructure/schemas/security-audit.schema.ts](src/modules/security/infrastructure/schemas/security-audit.schema.ts)
- [src/modules/security/infrastructure/security-audit.repository.ts](src/modules/security/infrastructure/security-audit.repository.ts)
- [src/modules/security/application/gdpr.service.ts](src/modules/security/application/gdpr.service.ts)
- [src/modules/security/interfaces/security.controller.ts](src/modules/security/interfaces/security.controller.ts)
- [src/modules/security/interfaces/security.routes.ts](src/modules/security/interfaces/security.routes.ts)
- [tests/integration/security-hardening.test.ts](tests/integration/security-hardening.test.ts), [tests/unit/rbac-ownership.test.ts](tests/unit/rbac-ownership.test.ts), [tests/unit/socket-auth.test.ts](tests/unit/socket-auth.test.ts), [tests/unit/production-guard.test.ts](tests/unit/production-guard.test.ts), [tests/unit/rate-limit.test.ts](tests/unit/rate-limit.test.ts)

**Zmienione (15):**

- [src/core/config/app.config.ts](src/core/config/app.config.ts) — `auth.adminUids`, `security.{rateLimitEnabled, rateLimitWindowMs, rateLimitMax, rateLimitAiMax, bodyLimit}`
- [src/core/events/event.types.ts](src/core/events/event.types.ts) — 6 nowych zdarzeń `security.*`
- [src/shared/middleware/auth.middleware.ts](src/shared/middleware/auth.middleware.ts) — `UserRole`, `resolveRole`
- [src/infrastructure/websocket/socket.gateway.ts](src/infrastructure/websocket/socket.gateway.ts) — `io.use(socketAuth)`, room guard
- [src/app.ts](src/app.ts) — `assertProductionSafety`, `trust proxy`, body limit z configa
- [src/routes/index.ts](src/routes/index.ts) — `globalRateLimit`, `/me`, `/admin`
- [src/modules/memory/interfaces/memory.routes.ts](src/modules/memory/interfaces/memory.routes.ts) — `requireOwnership` + `aiRateLimit`
- [src/modules/memory/infrastructure/intent-map.repository.interface.ts](src/modules/memory/infrastructure/intent-map.repository.interface.ts) — `purgeSession`
- [src/modules/memory/infrastructure/intent-map.mongo.repository.ts](src/modules/memory/infrastructure/intent-map.mongo.repository.ts) — `purgeSession`
- [src/modules/memory/infrastructure/intent-map.repository.ts](src/modules/memory/infrastructure/intent-map.repository.ts) — `purgeSession` (Postgres + Proxy)
- [src/modules/quest/interfaces/quest.controller.ts](src/modules/quest/interfaces/quest.controller.ts) — przepisany z `assertQuestOwnership`, uid bind
- [src/modules/quest/infrastructure/quest.repository.ts](src/modules/quest/infrastructure/quest.repository.ts) — `purgeUser`
- [src/modules/inventory/infrastructure/inventory.repository.ts](src/modules/inventory/infrastructure/inventory.repository.ts) — `purgeUser`
- [src/modules/resolver/infrastructure/goals.repository.ts](src/modules/resolver/infrastructure/goals.repository.ts) — `purgeUser` (interface + Mongo + Memory + Proxy)
- [src/modules/user/infrastructure/user.repository.ts](src/modules/user/infrastructure/user.repository.ts) — `delete(id)`
- [src/modules/logos/interfaces/logos.routes.ts](src/modules/logos/interfaces/logos.routes.ts) — `aiRateLimit` + `requireOwnership`
- [src/shared/validators/schemas.ts](src/shared/validators/schemas.ts) — `userId` opcjonalne (kontroler nadpisuje z tokenu)
- [package.json](package.json) — `express-rate-limit@^7`
- [tests/integration/quest-resolver.test.ts](tests/integration/quest-resolver.test.ts), [tests/integration/snapshot-timeline.test.ts](tests/integration/snapshot-timeline.test.ts) — dostosowane do nowej semantyki ownership

---

## VII. Weryfikacja B=1.0

```
TSC=0  (npx tsc --noEmit)
BUILD=0 (npx tsc -p tsconfig.json)
JEST=0 (46 passed, 1 skipped, 47 total)
```

Test Suites: **10 passed, 1 skipped, 10/11**.
Coverage globalny: 43.76% stmts (rośnie linearnie z każdym sprintem; gate niezdefiniowany, więc nie blokuje).
Czas pełnego run: ~27 s.

Nowe testy Sprintu VIII (5 plików):

| plik | scope | scenariusze |
|---|---|---|
| `rbac-ownership.test.ts` | unit | 401/403/ok dla `requireRole`, `requireAuthenticated`, `requireOwnership` (admin bypass, mismatch, brak pola) |
| `socket-auth.test.ts` | unit | `canJoinRoom`: undefined, admin, system, user-own, user-cross, anonim, prefix branch |
| `production-guard.test.ts` | unit | FATAL na ALLOW_ANONYMOUS=true w prod, FATAL na CORS=*, override przepuszcza |
| `rate-limit.test.ts` | unit | no-op gdy disabled, factory smoke gdy enabled |
| `security-hardening.test.ts` | integration | quest cudzy → 403, admin endpoint anonim → 403, RODO anonim → 401, memory cudzy → 403 |

---

## VIII. Otwarte fronty (po Fortyfikacji)

1. **Token Economizer (Faza II GCP)** — Vertex billing optymalizacja: cache embeddings, batch synthesize, semantic dedup przed wywołaniem LLM. Spodziewane oszczędności: 40–60% tokenów na powtarzających się intencjach.
2. **Redis store dla rate-limit** — gdy Cloud Run skoczy na `min-instances=2+`, lokalne limity przestają być spójne. `rate-limit-redis` + Memorystore = 1 dzień pracy.
3. **Audit do BigQuery** — `security_audit` w Mongo jest dobre na operacyjne 90 dni, ale compliance officer chce 7-letnie zapytania ad-hoc. BigQuery sink przez Pub/Sub.
4. **CSP + helmet hardening** — dorzucić `helmet()` z Content-Security-Policy stricter-than-default, HSTS, frame-ancestors.
5. **Brakujące coverage gates** — wymusić `--coverageThreshold` w `jest.config` żeby regresja jakości była mechaniczna, nie kosmetyczna.

---

## IX. Trzy ścieżki dalej (do decyzji Fenrira)

**Ścieżka 1 — Token Economizer (Faza II planu v6.0)**
Pełne zejście w cache + batch + dedup. Bezpośrednia kontynuacja roadmapy. Korzyść: realne PLN/USD oszczędności i przygotowanie pod skalowanie. Czas: 1 sprint.

**Ścieżka 2 — Helmet + CSP + audit-to-BigQuery (dokończenie fortyfikacji)**
Nie wracamy do warstwy aplikacyjnej, aż infra security będzie production-grade. Korzyść: zamknięcie OWASP A05 (Security Misconfiguration). Czas: 0.5 sprintu.

**Ścieżka 3 — Redis-backed rate limit + horizontal scale-out test**
Symulacja Cloud Run z `min-instances=2`, weryfikacja że limity, sesje i WS-room broadcast są spójne między instancjami. Korzyść: usunięcie ostatniego założenia "single process". Czas: 0.5–1 sprint.

> *Rekomendacja Architekta: **Ścieżka 1**. Fortyfikacja stoi, a token-economy to jedyny powód, dla którego LOGOS wytrzyma realny ruch dłużej niż jeden weekend. Helmet i Redis można dorzucić jako późniejsze pojedyncze commity — nie wymagają sprintu.*

---

*„Brama zamknięta. Strażnik nazwany. Audyt wieczny dla tych, którzy odeszli; ulotny dla tych, którzy tylko przeszli obok."*
— Architekt Strażnic, koniec Sprintu VIII.
