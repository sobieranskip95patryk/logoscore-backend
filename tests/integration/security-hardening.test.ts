/**
 * Sprint VIII — RBAC + Ownership + RODO endpoints (REST).
 *
 * Trzy wektory:
 *   1. Ownership guard na quest (cudzy questId → 403)
 *   2. Admin-only na /api/admin/security/audit (anonim → 403)
 *   3. RODO endpoints wymagają zweryfikowanego konta (anonim → 401)
 */
process.env.ALLOW_ANONYMOUS = 'true';
process.env.AI_PROVIDER = 'simulated';

import request from 'supertest';
import { createApp } from '../../src/app';

describe('integration: Sprint VIII security hardening', () => {
  const app = createApp();

  describe('Quest ownership guard', () => {
    it('blokuje complete cudzego questa (403 forbidden_quest_ownership)', async () => {
      // Tworzymy questa anonima, potem ręcznie nadpisujemy ownership w repo.
      const startRes = await request(app)
        .post('/api/quest/start')
        .send({ title: 'cudza droga' });
      expect(startRes.status).toBe(201);
      const questId = startRes.body.id;

      // Symulujemy "cudzy quest" przez bezpośrednią mutację repo.
      const { questRepository } = await import('../../src/modules/quest/infrastructure/quest.repository');
      const q = await questRepository.findById(questId);
      if (q) {
        q.userId = 'someone-else';
        await questRepository.update(q);
      }

      const completeRes = await request(app)
        .post('/api/quest/complete')
        .send({ questId });

      expect(completeRes.status).toBe(403);
      expect(completeRes.body.error).toBe('forbidden_quest_ownership');
    });
  });

  describe('Admin-only endpoints', () => {
    it('blokuje GET /api/admin/security/audit dla anonima (403)', async () => {
      const res = await request(app).get('/api/admin/security/audit');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    });
  });

  describe('RODO endpoints wymagają konta', () => {
    it('GET /api/me/export odrzuca anonima (401 authenticated_account_required)', async () => {
      const res = await request(app).get('/api/me/export');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('authenticated_account_required');
    });

    it('DELETE /api/me odrzuca anonima (401)', async () => {
      const res = await request(app).delete('/api/me');
      expect(res.status).toBe(401);
    });
  });

  describe('Memory ownership guard', () => {
    it('blokuje cudzy sessionId w intent-map.update (403)', async () => {
      const res = await request(app)
        .post('/api/memory/intent-map/update')
        .send({ sessionId: 'someone-else-uid', newIntent: 'wpis intencji' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden_ownership');
    });
  });
});
