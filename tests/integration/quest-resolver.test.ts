/**
 * Sprint VII — pętla Quest ↔ Resolver end-to-end.
 *
 * Sprawdzamy:
 *  1. POST /api/quest/start → 201 + state IN_PROGRESS + emit `quest.started`
 *  2. POST /api/quest/complete → 200 + state COMPLETED + emit `quest.completed`
 *  3. POST /api/quest/fail dla świeżego questa → 200 + state FAILED + emit `quest.failed`
 *  4. Bridge resolvera reaguje na oba sygnały (positive + negative)
 *
 * Bez Postgresa / Mongo / Vertexa — wszystko w pamięci, żadnego zewnętrznego I/O.
 */
process.env.ALLOW_ANONYMOUS = 'true';
process.env.AI_PROVIDER = 'simulated';

import request from 'supertest';
import { createApp } from '../../src/app';
import { eventBus } from '../../src/core/events/event-bus';
import { installQuestResolverBridge } from '../../src/modules/resolver/application/quest-bridge';

describe('integration: quest lifecycle + resolver bridge', () => {
  const app = createApp();
  // Sprint VIII: kontroler nadpisuje userId z tokenu (anonim w tym setupie).
  // Zachowujemy zmienną dla czytelności asercji.
  const userId = 'anonymous';

  beforeAll(() => {
    installQuestResolverBridge();
  });

  it('start → complete: emituje quest.started i quest.completed', async () => {
    const events: string[] = [];
    const off1 = eventBus.subscribe('quest.started',   () => { events.push('started'); });
    const off2 = eventBus.subscribe('quest.completed', () => { events.push('completed'); });

    const startRes = await request(app)
      .post('/api/quest/start')
      .send({
        userId,
        title: 'sprint VII closure',
        description: 'domknij pętle quest↔resolver',
        acceptanceCriteria: 'tsc + jest + build = 0'
      });

    expect(startRes.status).toBe(201);
    expect(startRes.body.state).toBe('IN_PROGRESS');
    const questId = startRes.body.id;

    const completeRes = await request(app)
      .post('/api/quest/complete')
      .send({ questId });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.state).toBe('COMPLETED');

    // EventBus jest synchroniczny dla subscribers — wystarczy mikro-tick na fire-and-forget bridge.
    await new Promise(r => setImmediate(r));

    expect(events).toContain('started');
    expect(events).toContain('completed');

    off1(); off2();
  });

  it('start → fail: emituje quest.failed', async () => {
    const failures: unknown[] = [];
    const off = eventBus.subscribe('quest.failed', (env) => { failures.push(env.payload); });

    const startRes = await request(app)
      .post('/api/quest/start')
      .send({ userId, title: 'rozpadnięty czyn' });

    const questId = startRes.body.id;

    const failRes = await request(app)
      .post('/api/quest/fail')
      .send({ questId, reason: 'symulacja entropii' });

    expect(failRes.status).toBe(200);
    expect(failRes.body.state).toBe('FAILED');

    await new Promise(r => setImmediate(r));

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ questId, userId, reason: 'symulacja entropii' });

    off();
  });

  it('odrzuca complete na evidence niewłaściwego stanu', async () => {
    const startRes = await request(app)
      .post('/api/quest/start')
      .send({ userId, title: 'test podwojnego complete' });

    const questId = startRes.body.id;

    const ok = await request(app).post('/api/quest/complete').send({ questId });
    expect(ok.status).toBe(200);

    const second = await request(app).post('/api/quest/complete').send({ questId });
    expect(second.status).toBeGreaterThanOrEqual(400);
  });
});
