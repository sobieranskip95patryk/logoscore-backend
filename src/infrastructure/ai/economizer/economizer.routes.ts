/**
 * Sprint IX — admin endpointy Token Economizera.
 * Tylko podgląd metryk + reset (do load-testów).
 */
import { Router, Response } from 'express';
import { firebaseAuthMiddleware, AuthenticatedRequest } from '../../../shared/middleware/auth.middleware';
import { requireRole } from '../../../shared/middleware/rbac.middleware';
import { economizerMetrics } from './metrics';
import { aiCacheRepository } from './ai-cache.repository';
import { lruSizes } from './index';

export const economizerRouter = Router();

economizerRouter.get('/metrics',
  firebaseAuthMiddleware,
  requireRole('admin'),
  async (_req: AuthenticatedRequest, res: Response) => {
    const [snapshot, persistent] = await Promise.all([
      Promise.resolve(economizerMetrics.snapshot()),
      aiCacheRepository.stats()
    ]);
    res.json({
      snapshot,
      lru: lruSizes(),
      persistent
    });
  }
);

economizerRouter.post('/reset',
  firebaseAuthMiddleware,
  requireRole('admin'),
  (_req: AuthenticatedRequest, res: Response) => {
    economizerMetrics.reset();
    res.json({ ok: true, resetAt: new Date().toISOString() });
  }
);
