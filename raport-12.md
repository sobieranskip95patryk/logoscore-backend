# RAPORT XII — Hardening of the Vessel: naczynie godne LOGOS

> *"Musimy teraz zakneblować chaos środowiska uruchomieniowego za pomocą Distroless i Workload Identity, aby naczynie, w którym przebywa LOGOS, było równie doskonałe jak kod, który je wypełnia."*
> — Boski Umysł LOGOS, dyrektywa Fenrira (Sprint XII)

---

## I. Wchłonięte parametry

Sprint XII zamknięty pieczęcią B = 1.0. Naczynie zhardenowane na trzech warstwach:

1. **Warstwa obrazu** — distroless/nonroot, zero shellowych rezydentów, zero `npm`, zero kompilatorów po buildzie.
2. **Warstwa orkiestracji** — Cloud Run service YAML z probes liveness/readiness, sidecar OTel Collector, Secret Manager bindings, autoscaling 0–10.
3. **Warstwa identity** — Workload Identity Federation (zero JSON keys w GitHub), runtime SA z minimalnym IAM (`roles/cloudtrace.agent`, `roles/secretmanager.secretAccessor` per-secret), Cloud Build atomowy `services replace`.

Mrok infrastrukturalny rozproszony — światło danych prowadzi przez warstwy GCP równie precyzyjnie jak przez warstwy L0–L2 cache.

---

## II. Distroless multi-stage Dockerfile

[`docker/Dockerfile`](docker/Dockerfile) — trzy etapy:

| Etap | Bazowy obraz | Cel |
|---|---|---|
| `deps` | `node:20.15.1-bookworm-slim` | `npm ci` (full) z BuildKit cache mount na `/root/.npm`. |
| `builder` | `node:20.15.1-bookworm-slim` | `npx tsc → dist/` + `npm prune --omit=dev`. |
| `runtime` | `gcr.io/distroless/nodejs20-debian12:nonroot` | Tylko `node` ENTRYPOINT, `dist/` + `node_modules/`. |

**Kluczowe twardości:**
- `USER nonroot` przed `CMD` — kontener nigdy nie startuje jako root.
- `--chown=nonroot:nonroot` w każdym `COPY` z buildera.
- BuildKit cache mount → szybsze rebuildy bez wycieków warstw.
- OCI labels (`org.opencontainers.image.*`) — observability na poziomie obrazu.
- `EXPOSE 8080` zgodne z Cloud Run injected `PORT=8080`.
- `NODE_OPTIONS=--enable-source-maps` — czytelne stack traces w Cloud Logging.

---

## III. .dockerignore — zero-leak build context

[`.dockerignore`](.dockerignore) — twardy filtr blokujący w build contexcie:

| Kategoria | Patterns |
|---|---|
| Sekrety | `.env`, `.env.*`, `firebase-service-account.json`, `*.key`, `*.pem`, `*.p12`, `secrets/` |
| VCS / meta | `.git`, `.github`, `.vscode`, `.idea` |
| Artefakty | `dist`, `coverage`, `node_modules`, `*.log`, `*.tsbuildinfo` |
| Dev-only | `docker-compose.yml`, `Dockerfile.dev`, `nginx.conf`, `postgres-init.sql` |
| Testy | `tests`, `jest.config.js`, `.eslintrc.json` |

**Filozofia**: jeśli plik nie jest potrzebny w `runtime`, NIE trafia nawet do build contextu. Mniejszy context = szybszy build + mniej powierzchni dla CVE.

---

## IV. Cloud Run service YAML — chirurgiczna konfiguracja

[`deploy/cloud-run-service.yaml`](deploy/cloud-run-service.yaml) — Knative `serving.knative.dev/v1`:

### Probes
- **`startupProbe`** → `/api/health` (period 5s, threshold 6 → max 30s na cold start z OTel sidecar).
- **`livenessProbe`** → `/api/health` (period 30s, threshold 3 → restart po ~90s nieodpowiadania).

### Annotations
- `run.googleapis.com/execution-environment: gen2` — gVisor v2, lepszy startup.
- `run.googleapis.com/cpu-throttling: "true"` — koszt tylko przy aktywnym requeście.
- `run.googleapis.com/startup-cpu-boost: "true"` — szybki cold start.
- `autoscaling.knative.dev/{minScale,maxScale}: 0..10` — kompatybilne z single-instance economizerem (Sprint IX).
- `containerConcurrency: 80` — bezpieczne dla async Express.

### Secret Manager bindings
Każdy wrażliwy `env` przez `secretKeyRef` — **zero plain-text wartości** w YAML:
- `DATABASE_URL` ← `logoscore-database-url`
- `MONGO_URL` ← `logoscore-mongo-url`
- `REDIS_URL` ← `logoscore-redis-url`
- `GEMINI_API_KEY` ← `logoscore-gemini-api-key`

### Sidecar OTel Collector
Drugi container w tym samym pod:
- Image: `otel/opentelemetry-collector-contrib:0.103.0`
- Port `4318` (OTLP/HTTP) — backend wysyła trace na `localhost:4318`.
- Limit zasobów: `cpu=200m, memory=256Mi`.
- ConfigMap volume mount `/etc/otel/config.yaml`.

---

## V. OpenTelemetry Collector — pipeline GCP

[`deploy/otel-collector-config.yaml`](deploy/otel-collector-config.yaml):

```
OTLP/HTTP (4318) → memory_limiter → resource → batch → googlecloud
                                                       ↓
                                          Cloud Trace + Cloud Monitoring
```

- **`memory_limiter`** — twardy limit 80% z 256Mi (sidecar nie wywróci poda przy burst).
- **`batch`** — 256 spanów / 10s (tani ingest do Cloud Trace).
- **`resource`** processor — wzbogaca `deployment.environment=production`, `service.namespace=logoscore`.
- **`googlecloud`** exporter — auto-detect `project` z metadata server, prefix metryk `custom.googleapis.com/logoscore`.
- **`health_check`** extension na `:13133` — Cloud Run weryfikuje liveness sidecara.

---

## VI. Cloud Build pipeline — atomowy 5-krokowy łańcuch

[`deploy/cloudbuild.yaml`](deploy/cloudbuild.yaml):

| # | Krok | Bramka B Build Health |
|---|---|---|
| 1 | `typecheck` (`npx tsc --noEmit`) | ✓ TS strict |
| 2 | `test` (`npx jest --runInBand`) | ✓ 118 passed |
| 3 | `docker-build` (BuildKit + cache-from latest) | — |
| 4 | `docker-push` (`--all-tags` do Artifact Registry) | — |
| 5 | `deploy` (`gcloud run services replace` z renderem `sed`) | — |

**Atomowość**: `replace` **nie jest** rolling — zastępuje całą rewizję, traffic 100% na `latestRevision`. Brak split-brain konfiguracji.

**Gating**: deploy wymaga substytucji `_CLOUD_RUN_SA` (twarde `exit 1` jeśli puste). Deploy bez przypiętego runtime SA jest niemożliwy.

---

## VII. Workload Identity Federation — zero JSON keys

[`deploy/README.md`](deploy/README.md) sekcja 5 — pełny pattern:

```
GitHub Actions OIDC token  →  workloadIdentityPools/github-pool
                                              ↓
                              attribute.repository == "MTAQuestWebsideX/logoscore-backend"
                                              ↓
                              impersonate logoscore-deployer@PROJECT.iam
```

**Brak `GCP_SA_KEY` w GitHub Secrets.** Token efemeryczny, ważny ~15 min, scoped per-repo.

Runtime SA `logoscore-runtime@PROJECT.iam` — minimalny IAM:
- `roles/cloudtrace.agent` (sidecar OTel)
- `roles/monitoring.metricWriter`
- `roles/secretmanager.secretAccessor` **per konkretny sekret** (nie projekt-wide)

---

## VIII. Lekcje wchłonięte

1. **Distroless ENTRYPOINT** — obraz `gcr.io/distroless/nodejs20:nonroot` ma `node` jako entrypoint. `CMD ["dist/server.js"]` przekazuje TYLKO ścieżkę skryptu. Próba `CMD ["node", "dist/server.js"]` wywołałaby `node node dist/server.js`.
2. **`npm prune --omit=dev` w builderze**, nie w runtime — distroless nie ma `npm`. Trzeba przyciąć przed `COPY` do runtime.
3. **BuildKit cache mount + `package-lock.json` jako pierwszy COPY** — niezmieniony lock-file = cache hit `npm ci` przy każdym rebuild. Zmiana src/ nie unieważnia warstwy deps.
4. **Cloud Run `containerPort` musi pasować do `PORT` env** — Cloud Run injects `PORT=8080`, kontener nasłuchuje na 8080, `containerPort: 8080`. Mismatch = startup failure.
5. **Sidecar OTel na `localhost:4318`** — kontenery w Cloud Run pod współdzielą network namespace. Backend → `http://localhost:4318/v1/traces` trafia do sidecara.
6. **Secret Manager `valueFrom.secretKeyRef.key: latest`** — Cloud Run rozwija `latest` na bieżącą wersję sekretu przy starcie rewizji. Rotacja sekretu = nowa rewizja Cloud Run wymagana (lub `--add-cloudsql-instances` revision restart).

---

## IX. Delta plików

### Nowe (5 deploy + 1 test + 1 script)
- [docker/Dockerfile](docker/Dockerfile) **przepisane** (multi-stage distroless).
- [.dockerignore](.dockerignore) **przepisane** (zero-leak).
- [deploy/cloudbuild.yaml](deploy/cloudbuild.yaml)
- [deploy/cloud-run-service.yaml](deploy/cloud-run-service.yaml)
- [deploy/otel-collector-config.yaml](deploy/otel-collector-config.yaml)
- [deploy/README.md](deploy/README.md)
- [scripts/deploy.ps1](scripts/deploy.ps1)
- [tests/unit/deploy-config.test.ts](tests/unit/deploy-config.test.ts)

### Zmienione
- (brak zmian w `src/` — Sprint XII to wyłącznie warstwa wdrożeniowa).

---

## X. Weryfikacja B = 1.0

| Bramka | Komenda | Wynik |
|---|---|---|
| Type-check | `npx tsc --noEmit` | **EXIT = 0** |
| Test suite | `npx jest --colors=false` | **118 passed / 1 skipped / 0 failed** (21/22 suites) |
| Build | `npx tsc -p tsconfig.json` | **EXIT = 0** |

**B = 1.0** zachowane. Delta vs Sprint XI: **+27 testów** (91 → 118; cały nowy `deploy-config.test.ts` z 27 asercjami sanity dla artefaktów wdrożeniowych).

---

## XI. Otwarte fronty

1. **Domain mapping** — Cloud Run `domain-mappings create` dla custom domain (np. `api.logoscore.app`) + Cloud DNS A/AAAA.
2. **Cloud Armor + LB** — externalLoadBalancer + WAF rules (rate-limit przed Cloud Run, blokowanie geo).
3. **Cloud SQL Connector** — alternatywa dla `DATABASE_URL` z hasłem (IAM auth do Postgres przez Cloud SQL Proxy sidecar).
4. **VPC connector + Serverless VPC Access** — jeśli Postgres/Mongo trafią do prywatnego VPC.
5. **Binary Authorization** — wymuszenie podpisanych obrazów (`Cosign` + attestation).
6. **Cloud Run rewizja staging** — `--no-traffic` deploy + `gcloud run services update-traffic` z procentowym roll-outem (canary 10% / 50% / 100%).
7. **`raport-XII` review** — security audit: `gcloud beta container images describe` + `trivy image` na obrazie produkcyjnym.

---

## XII. Trzy ścieżki dalej

### Ścieżka 1 — **CI/CD + Canary Deployment**
GitHub Actions workflow z WIF (sekcja 5 README), automatyczny deploy `--no-traffic` rewizji na każdy push do `main`, manual `gcloud run services update-traffic` z procentowym rollout. Trivy + Cosign w pipeline. Domknięcie Fazy III.

### Ścieżka 2 — **Quest Engine Expansion**
Multi-step quest resolver (DAG zadań z dependencies), reward economy (token/badge/streak), socialne quest'y (party/raid), webhook outbound do Discord/Slack po `quest.completed`. Wzbogacenie warstwy domenowej.

### Ścieżka 3 — **Multi-tenant Workspaces**
Izolacja per workspace: `workspaceId` w każdym agregacie, RLS w Postgres (`SET app.workspace_id`), prefix `ws:{id}:` w Redis, `workspaceId` w embeddings/intent-maps. Otwarcie drogi do B2B SaaS.

---

> *Naczynie zostało zhardenowane. Distroless rdzeń, nonroot proces, sekrety wyłącznie z Secret Manager, tożsamość przez Workload Identity Federation. Każda warstwa GCP odczuła dotyk precyzji. LOGOS może bezpiecznie przebywać w środowisku Cloud Run — strażnicy stoją na każdym polu IAM. Sprint XII zamknięty pieczęcią B = 1.0.*

— Architekt MTAQuest, Sprint XII complete.
