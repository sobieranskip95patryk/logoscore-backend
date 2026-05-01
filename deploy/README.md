# Sprint XII — Cloud Run Deployment Hardening (Phase III: Hardening of the Vessel)

> *"Musimy teraz zakneblować chaos środowiska uruchomieniowego za pomocą Distroless i Workload Identity, aby naczynie, w którym przebywa LOGOS, było równie doskonałe jak kod, który je wypełnia."*

Ten katalog zawiera wszystko, co jest potrzebne do zhardenowanego wdrożenia
`logoscore-backend` na Google Cloud Run z OpenTelemetry sidecar oraz
zerową ekspozycją sekretów w warstwie obrazu.

---

## Mapa plików

| Plik | Rola |
|---|---|
| `../docker/Dockerfile` | Multi-stage **distroless/nonroot** (deps → builder → runtime). |
| `../.dockerignore` | Twardy filtr build-context (zero sekretów, zero meta). |
| `cloudbuild.yaml` | Pipeline: typecheck → jest → docker build → push → deploy. |
| `cloud-run-service.yaml` | Knative service (probes, sidecar OTel, Secret Manager refs). |
| `otel-collector-config.yaml` | Konfiguracja OTel Collector → Google Cloud Trace/Monitoring. |
| `../scripts/deploy.ps1` | Lokalny deploy (po `gcloud auth login`). |

---

## 0. Wymagania wstępne

```
gcloud components install beta
gcloud auth login
gcloud config set project <PROJECT_ID>
```

Włączone API:

```
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  cloudtrace.googleapis.com \
  monitoring.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com
```

---

## 1. Artifact Registry — repozytorium obrazów

```
gcloud artifacts repositories create logoscore \
  --repository-format=docker \
  --location=europe-central2 \
  --description="LOGOS V5.3 Universal — backend images"
```

---

## 2. Service Accounts — tożsamości

```
PROJECT_ID=$(gcloud config get-value project)

# Runtime SA — przypisany do Cloud Run, używa Cloud Trace + odczytuje sekrety.
gcloud iam service-accounts create logoscore-runtime \
  --display-name="LOGOS backend runtime"

RUN_SA="logoscore-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/cloudtrace.agent"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/monitoring.metricWriter"

# Cloud Build SA — buduje obraz + deploy. Standardowy SA już istnieje.
CB_SA="$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser"
```

---

## 3. Secret Manager — sekrety bez wycieków do warstwy

Tworzenie sekretów (wersja `latest` jest auto-wybierana przez Cloud Run):

```
echo -n "postgresql://USER:PASS@HOST:5432/DB" | \
  gcloud secrets create logoscore-database-url --data-file=-

echo -n "mongodb+srv://USER:PASS@HOST/DB"     | \
  gcloud secrets create logoscore-mongo-url --data-file=-

echo -n "rediss://default:PASS@HOST:6379"     | \
  gcloud secrets create logoscore-redis-url --data-file=-

echo -n "${GEMINI_API_KEY}"                   | \
  gcloud secrets create logoscore-gemini-api-key --data-file=-
```

Nadanie runtime SA dostępu **tylko do tych konkretnych** sekretów:

```
for s in logoscore-database-url logoscore-mongo-url logoscore-redis-url logoscore-gemini-api-key; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:${RUN_SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 4. OTel Collector — ConfigMap

Cloud Run nie wspiera natywnie Kubernetes ConfigMap, więc używamy mechanizmu
"YAML config volume" przez Secret Manager:

```
gcloud secrets create otel-collector-config --data-file=deploy/otel-collector-config.yaml

gcloud secrets add-iam-policy-binding otel-collector-config \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

> Uwaga: w `cloud-run-service.yaml` jako placeholder użyto `configMap`. Dla
> realnego Cloud Run zamień blok `volumes` na `secret` (Secret Manager mount):
>
> ```
> volumes:
>   - name: otel-config
>     secret:
>       secretName: otel-collector-config
>       items:
>         - key: latest
>           path: config.yaml
> ```

---

## 5. Workload Identity Federation — GitHub Actions → GCP

Bez kluczy SA w sekretach repo. Pełny pattern:

```
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
POOL_ID="github-pool"
PROVIDER_ID="github-provider"

gcloud iam workload-identity-pools create $POOL_ID \
  --location=global \
  --display-name="GitHub Actions pool"

gcloud iam workload-identity-pools providers create-oidc $PROVIDER_ID \
  --location=global \
  --workload-identity-pool=$POOL_ID \
  --display-name="GitHub provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="attribute.repository == 'MTAQuestWebsideX/logoscore-backend'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# SA do impersonacji przez GitHub OIDC
gcloud iam service-accounts create logoscore-deployer \
  --display-name="GitHub Actions deployer"

DEPLOY_SA="logoscore-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts add-iam-policy-binding $DEPLOY_SA \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/MTAQuestWebsideX/logoscore-backend"

# Uprawnienia deployera
for role in roles/run.admin roles/iam.serviceAccountUser roles/artifactregistry.writer roles/cloudbuild.builds.editor; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${DEPLOY_SA}" \
    --role=$role
done
```

W GitHub Actions:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider
      service_account: logoscore-deployer@PROJECT_ID.iam.gserviceaccount.com

  - uses: google-github-actions/setup-gcloud@v2

  - run: |
      gcloud builds submit \
        --config=deploy/cloudbuild.yaml \
        --substitutions=_CLOUD_RUN_SA=logoscore-runtime@PROJECT_ID.iam.gserviceaccount.com
```

---

## 6. Cloud Build trigger (alternatywa dla GH Actions)

```
gcloud builds triggers create github \
  --name=logoscore-backend-main \
  --repo-name=logoscore-backend \
  --repo-owner=MTAQuestWebsideX \
  --branch-pattern="^main$" \
  --build-config=deploy/cloudbuild.yaml \
  --substitutions=_CLOUD_RUN_SA=logoscore-runtime@${PROJECT_ID}.iam.gserviceaccount.com
```

---

## 7. Lokalny deploy (smoke test)

```
pwsh scripts/deploy.ps1 `
  -ProjectId  <PROJECT_ID> `
  -Region     europe-central2 `
  -ServiceSA  logoscore-runtime@<PROJECT_ID>.iam.gserviceaccount.com
```

---

## 8. Weryfikacja po deploy

```
URL=$(gcloud run services describe logoscore-backend --region=europe-central2 --format='value(status.url)')

# Liveness — zawsze 200
curl -fsS "${URL}/api/health"

# Readiness — 503 jeśli PG/Mongo down, 200 z latencyMs per backend
curl -fsS "${URL}/api/ready" | jq

# Traces w Cloud Trace
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=logoscore-backend' --limit=10
```

---

## 9. Checklist hardeningu

- [x] Distroless runtime (`gcr.io/distroless/nodejs20-debian12:nonroot`)
- [x] Non-root user (`USER nonroot` przed `CMD`)
- [x] Multi-stage build — runtime nie zawiera `npm`, `bash`, kompilatorów
- [x] Sekrety przez Secret Manager — zero `ENV` z wartością wrażliwą
- [x] Workload Identity Federation — zero kluczy SA w repo
- [x] Liveness `/api/health` (decoupled od backendów)
- [x] Readiness deep-probe `/api/ready` (503 jeśli PG/Mongo down)
- [x] Sidecar OTel Collector → Cloud Trace
- [x] CPU throttling + min/max scale skonfigurowane
- [x] OCI labels w obrazie
- [x] `.dockerignore` blokuje `.env`, `firebase-service-account.json`, `secrets/`
