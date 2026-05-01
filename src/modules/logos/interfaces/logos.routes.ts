import { Router } from 'express';
import { LogosController } from './logos.controller';
import { firebaseAuthMiddleware } from '../../../shared/middleware/auth.middleware';
import { validateBody } from '../../../shared/middleware/validate.middleware';
import { aiRateLimit } from '../../../shared/middleware/rate-limit.middleware';
import { requireOwnership } from '../../../shared/middleware/ownership.middleware';
import { analyzeSchema, synthesizeSchema } from '../../../shared/validators/schemas';

export const logosRouter = Router();

logosRouter.post('/analyze',
  firebaseAuthMiddleware,
  aiRateLimit,
  validateBody(analyzeSchema),
  requireOwnership('body', 'sessionId'),
  LogosController.analyze
);

logosRouter.post('/synthesize',
  firebaseAuthMiddleware,
  aiRateLimit,
  validateBody(synthesizeSchema),
  requireOwnership('body', 'sessionId'),
  LogosController.synthesize
);
