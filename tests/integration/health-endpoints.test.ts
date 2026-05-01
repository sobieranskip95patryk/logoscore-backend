/**
 * Sprint XI — health endpoints:
 *  - /api/health = liveness, zawsze 200, brak deep-probe
 *  - /api/ready  = readiness, deep-probe Postgres/Mongo/Redis, latencyMs per backend
 *  Status 503 gdy krytyczne backendy (PG+Mongo) niezdrowe; Redis opcjonalny.
 */
process.env.ECONOMIZER_ENABLED = 'false';
process.env.AI_PROVIDER = 'simulated';
process.env.ALLOW_ANONYMOUS = 'true';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import { createApp } from '../../src/app';

describe('health endpoints', () => {
  const app = createApp();

  it('/api/health → 200 z metadata, bez backend probe', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('online');
    expect(res.body.service).toBeDefined();
    expect(res.body.version).toBeDefined();
    expect(res.body.backends).toBeUndefined(); // liveness nie probiuje
  });

  it('/api/ready → zawiera backends + latencyMs per backend + probeMs', async () => {
    const res = await request(app).get('/api/ready');
    // bez Postgres+Mongo w teście status będzie 503; struktura pozostaje.
    expect([200, 503]).toContain(res.status);
    expect(res.body.backends).toBeDefined();
    expect(res.body.backends.postgres).toHaveProperty('up');
    expect(res.body.backends.postgres).toHaveProperty('latencyMs');
    expect(res.body.backends.mongo).toHaveProperty('up');
    expect(res.body.backends.mongo).toHaveProperty('latencyMs');
    expect(res.body.backends.redis).toHaveProperty('up');
    expect(res.body.backends.redis).toHaveProperty('required', false);
    expect(typeof res.body.probeMs).toBe('number');
  });

  it('/health top-level liveness → 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('online');
  });
});
