import { Router } from 'express';
import { firebaseAuthMiddleware, AuthenticatedRequest } from '../../../shared/middleware/auth.middleware';
import { requireRole } from '../../../shared/middleware/rbac.middleware';
import { migiControlPlane } from '../application/migi.control-plane';

export const migiRouter = Router();

migiRouter.use(firebaseAuthMiddleware, requireRole('admin'));

migiRouter.get('/status', async (_req: AuthenticatedRequest, res, next) => {
  try {
    res.json(await migiControlPlane.status());
  } catch (e) { next(e); }
});

migiRouter.post('/start', async (_req: AuthenticatedRequest, res, next) => {
  try {
    res.json(await migiControlPlane.start());
  } catch (e) { next(e); }
});

migiRouter.post('/stop', async (_req: AuthenticatedRequest, res, next) => {
  try {
    res.json(await migiControlPlane.stop());
  } catch (e) { next(e); }
});

migiRouter.post('/restart', async (_req: AuthenticatedRequest, res, next) => {
  try {
    res.json(await migiControlPlane.restart());
  } catch (e) { next(e); }
});
