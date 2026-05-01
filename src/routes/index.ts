import { Express, Router } from 'express';
import { logosRouter }     from '../modules/logos/interfaces/logos.routes';
import { memoryRouter }    from '../modules/memory/interfaces/memory.routes';
import { questRouter }     from '../modules/quest/interfaces/quest.routes';
import { userRouter }      from '../modules/user/interfaces/user.routes';
import { inventoryRouter } from '../modules/inventory/interfaces/inventory.routes';
import { resolverRouter }  from '../modules/resolver/interfaces/resolver.routes';
import { meRouter, adminRouter } from '../modules/security/interfaces/security.routes';
import { economizerRouter } from '../infrastructure/ai/economizer/economizer.routes';
import { pingPostgres, isPgvectorReady } from '../infrastructure/database/postgres';
import { pingMongo, isMongoReady } from '../infrastructure/database/mongo';
import { pingRedis } from '../infrastructure/database/redis';
import { intentMapRepository } from '../modules/memory/infrastructure/intent-map.repository';
import { goalsRepository } from '../modules/resolver/infrastructure/goals.repository';
import { SYSTEM_NAME, SYSTEM_VERSION } from '../shared/constants';
import { globalRateLimit } from '../shared/middleware/rate-limit.middleware';

/** Sprint XI: instrumentacja deep-probe latencji w /ready. */
async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t };
}

export function registerRoutes(app: Express): void {
  const api = Router();

  api.get('/health', (_req, res) => {
    // Liveness: tylko proces żyje. Brak deep-probe — szybkie i stabilne dla
    // kubelet/Cloud Run health checków, które nie powinny restartować przy
    // chwilowej niedostępności DB.
    res.json({
      status: 'online',
      service: SYSTEM_NAME,
      version: SYSTEM_VERSION,
      timestamp: new Date().toISOString()
    });
  });

  api.get('/ready', async (_req, res) => {
    // Readiness: deep-probe do wszystkich backendów. 503 gdy krytyczne backendy
    // (mongo dla intent map, postgres dla pgvector) niezdrowe — load balancer
    // wycofuje instancję z rotacji do czasu naprawy.
    const tStart = Date.now();
    const [pg, mongo, redis] = await Promise.all([
      timed(() => pingPostgres().catch(() => false)),
      timed(() => pingMongo().catch(() => false)),
      timed(() => pingRedis().catch(() => false))
    ]);
    const allRequiredUp = pg.value && mongo.value;  // Redis opcjonalny
    res.status(allRequiredUp ? 200 : 503).json({
      status: allRequiredUp ? 'ready' : 'degraded',
      service: SYSTEM_NAME,
      version: SYSTEM_VERSION,
      probeMs: Date.now() - tStart,
      backends: {
        postgres: { up: pg.value, latencyMs: pg.ms, pgvector: isPgvectorReady() },
        mongo:    { up: mongo.value, latencyMs: mongo.ms, ready: isMongoReady() },
        redis:    { up: redis.value, latencyMs: redis.ms, required: false }
      },
      memory: { backend: intentMapRepository.backend },
      resolver: { backend: goalsRepository.backend },
      timestamp: new Date().toISOString()
    });
  });

  // Globalny rate-limit przed wszystkimi mutacjami (poza /health i /ready).
  api.use(globalRateLimit);

  api.use('/logos',     logosRouter);
  api.use('/memory',    memoryRouter);
  api.use('/quest',     questRouter);
  api.use('/user',      userRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/resolver',  resolverRouter);
  api.use('/me',        meRouter);
  api.use('/admin',     adminRouter);
  api.use('/admin/economizer', economizerRouter);

  app.use('/api', api);

  // Top-level liveness (np. dla nginx /health)
  app.get('/health', (_req, res) => res.json({ status: 'online' }));
}
