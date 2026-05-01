import { Router } from 'express';
import { firebaseAuthMiddleware, AuthenticatedRequest } from '../../../shared/middleware/auth.middleware';
import { userRepository } from '../infrastructure/user.repository';

export const userRouter = Router();

userRouter.get('/me', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'unauthenticated' }); return; }
    const user = await userRepository.ensure(req.user.uid, req.user.anonymous);
    res.json(user);
  } catch (e) { next(e); }
});
