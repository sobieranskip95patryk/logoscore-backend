/**
 * Sprint XII — sanity check artefaktów wdrożeniowych Cloud Run.
 * Test pilnuje, że krytyczne pliki istnieją i zawierają hardeningowe markery.
 * To NIE jest weryfikacja runtime GCP — tylko zapora przed regresjami w repo.
 */
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf-8');

describe('Sprint XII — deploy artifacts hardening', () => {

  describe('docker/Dockerfile (distroless multi-stage)', () => {
    const df = read('docker/Dockerfile');

    it('używa distroless nonroot runtime', () => {
      // Akceptujemy zarówno inline tag, jak i ARG z domyślnym `nonroot`.
      const inlineMatch  = /gcr\.io\/distroless\/[^\s${}]*nonroot/.test(df);
      const argDefault   = /ARG\s+DISTROLESS_TAG=[^\s]*nonroot/.test(df);
      const usesArgFrom  = /FROM\s+gcr\.io\/distroless\/\$\{DISTROLESS_TAG\}/.test(df);
      expect(inlineMatch || (argDefault && usesArgFrom)).toBe(true);
    });

    it('ma multi-stage: deps + builder + runtime', () => {
      expect(df).toMatch(/AS deps\b/);
      expect(df).toMatch(/AS builder\b/);
      expect(df).toMatch(/AS runtime\b/);
    });

    it('przełącza się na non-root user', () => {
      expect(df).toMatch(/^USER nonroot$/m);
    });

    it('ustawia NODE_ENV=production', () => {
      expect(df).toMatch(/NODE_ENV=production/);
    });

    it('przycina dev dependencies przed runtime', () => {
      expect(df).toMatch(/npm prune --omit=dev/);
    });

    it('eksponuje port 8080 (Cloud Run default PORT)', () => {
      expect(df).toMatch(/EXPOSE 8080/);
    });
  });

  describe('.dockerignore (zero-leak build context)', () => {
    const di = read('.dockerignore');
    it.each([
      ['.env', /^\.env$/m],
      ['firebase-service-account.json', /firebase-service-account\.json/],
      ['secrets/', /^secrets\/$/m],
      ['node_modules', /^node_modules$/m],
      ['.git', /^\.git$/m],
      ['tests', /^tests$/m]
    ])('blokuje %s', (_label, re) => {
      expect(di).toMatch(re);
    });
  });

  describe('deploy/cloud-run-service.yaml', () => {
    const yaml = read('deploy/cloud-run-service.yaml');

    it('liveness probe wskazuje /api/health', () => {
      expect(yaml).toMatch(/livenessProbe[\s\S]*?path: \/api\/health/);
    });

    it('startup probe wskazuje /api/health', () => {
      expect(yaml).toMatch(/startupProbe[\s\S]*?path: \/api\/health/);
    });

    it('zawiera serviceAccountName z placeholderem', () => {
      expect(yaml).toMatch(/serviceAccountName: __CLOUD_RUN_SA__/);
    });

    it('sekrety pobierane przez secretKeyRef (nie ENV plain)', () => {
      expect(yaml).toMatch(/secretKeyRef:[\s\S]*?name: logoscore-database-url/);
      expect(yaml).toMatch(/secretKeyRef:[\s\S]*?name: logoscore-mongo-url/);
      expect(yaml).toMatch(/secretKeyRef:[\s\S]*?name: logoscore-redis-url/);
      expect(yaml).toMatch(/secretKeyRef:[\s\S]*?name: logoscore-gemini-api-key/);
    });

    it('ma sidecar otel-collector na porcie 4318', () => {
      expect(yaml).toMatch(/name: otel-collector/);
      expect(yaml).toMatch(/containerPort: 4318/);
    });

    it('TELEMETRY_ENABLED=true + OTLP endpoint na localhost:4318', () => {
      expect(yaml).toMatch(/TELEMETRY_ENABLED[\s\S]*?value: "true"/);
      expect(yaml).toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT[\s\S]*?value: http:\/\/localhost:4318/);
    });

    it('ma autoscaling annotations (min/max scale)', () => {
      expect(yaml).toMatch(/autoscaling\.knative\.dev\/minScale/);
      expect(yaml).toMatch(/autoscaling\.knative\.dev\/maxScale/);
    });
  });

  describe('deploy/otel-collector-config.yaml', () => {
    const cfg = read('deploy/otel-collector-config.yaml');

    it('odbiera OTLP HTTP na 4318', () => {
      expect(cfg).toMatch(/http:[\s\S]*?endpoint: 0\.0\.0\.0:4318/);
    });

    it('eksportuje do googlecloud (Cloud Trace + Monitoring)', () => {
      expect(cfg).toMatch(/^exporters:[\s\S]*?googlecloud:/m);
    });

    it('ma processors: memory_limiter + batch', () => {
      expect(cfg).toMatch(/memory_limiter:/);
      expect(cfg).toMatch(/batch:/);
    });

    it('pipelines traces i metrics używają googlecloud', () => {
      expect(cfg).toMatch(/traces:[\s\S]*?exporters: \[googlecloud\]/);
      expect(cfg).toMatch(/metrics:[\s\S]*?exporters: \[googlecloud\]/);
    });
  });

  describe('deploy/cloudbuild.yaml', () => {
    const cb = read('deploy/cloudbuild.yaml');

    it('zawiera bramki typecheck + test PRZED docker build', () => {
      const idxTypecheck = cb.indexOf('id: typecheck');
      const idxTest      = cb.indexOf('id: test');
      const idxBuild     = cb.indexOf('id: docker-build');
      expect(idxTypecheck).toBeGreaterThan(-1);
      expect(idxTest).toBeGreaterThan(idxTypecheck);
      expect(idxBuild).toBeGreaterThan(idxTest);
    });

    it('uruchamia npx tsc --noEmit', () => {
      expect(cb).toMatch(/npx tsc --noEmit/);
    });

    it('uruchamia jest --runInBand', () => {
      expect(cb).toMatch(/npx jest[^\n]*--runInBand/);
    });

    it('deploy używa gcloud run services replace (atomic)', () => {
      expect(cb).toMatch(/gcloud run services replace/);
    });
  });
});
