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

    it('blokuje GET /api/admin/migi/status dla anonima (403)', async () => {
      const res = await request(app).get('/api/admin/migi/status');
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

  describe('Resolver goal ownership guard', () => {
    it('blokuje reembed cudzego celu (404 goal_not_found)', async () => {
      const createRes = await request(app)
        .post('/api/resolver/goals')
        .set('Authorization', 'Bearer user-owner')
        .send({ title: 'owner goal' });
      expect(createRes.status).toBe(201);
      const goalId = createRes.body.goalId;

      const reembedAsOther = await request(app)
        .post(`/api/resolver/goals/${goalId}/reembed`)
        .set('Authorization', 'Bearer user-other')
        .send();

      expect(reembedAsOther.status).toBe(404);
      expect(reembedAsOther.body.error).toBe('goal_not_found');
    });

    it('blokuje delete cudzego celu i pozwala właścicielowi usunąć (404 -> 200)', async () => {
      const createRes = await request(app)
        .post('/api/resolver/goals')
        .set('Authorization', 'Bearer user-owner-2')
        .send({ title: 'owner goal 2' });
      expect(createRes.status).toBe(201);
      const goalId = createRes.body.goalId;

      const deleteAsOther = await request(app)
        .delete(`/api/resolver/goals/${goalId}`)
        .set('Authorization', 'Bearer user-other-2');
      expect(deleteAsOther.status).toBe(404);
      expect(deleteAsOther.body.error).toBe('goal_not_found');

      const deleteAsOwner = await request(app)
        .delete(`/api/resolver/goals/${goalId}`)
        .set('Authorization', 'Bearer user-owner-2');
      expect(deleteAsOwner.status).toBe(200);
      expect(deleteAsOwner.body.ok).toBe(true);
    });
  });
});
