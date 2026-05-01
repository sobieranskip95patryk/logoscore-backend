/**
 * Sprint VII — snapshot timeline endpoint.
 * Bez Mongo backend zwraca pustą listę (kontrakt graceful degradation).
 */
process.env.ALLOW_ANONYMOUS = 'true';

import request from 'supertest';
import { createApp } from '../../src/app';

describe('integration: GET /api/memory/snapshots', () => {
  const app = createApp();

  it('zwraca pustą listę gdy brak Mongo (Postgres backend nie wspiera audit)', async () => {
    // Sprint VIII: ownership guard wymaga sessionId === uid (anonim) lub admin.
    const res = await request(app)
      .get('/api/memory/snapshots')
      .query({ sessionId: 'anonymous', limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sessionId: 'anonymous',
      count: 0,
      snapshots: []
    });
  });

  it('odrzuca cudzy sessionId (ownership guard)', async () => {
    const res = await request(app)
      .get('/api/memory/snapshots')
      .query({ sessionId: 'someone-else-uid' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_ownership');
  });
});
