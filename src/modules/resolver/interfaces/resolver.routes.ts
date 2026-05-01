import { Router } from 'express';
import { ResolverController } from './resolver.controller';
import { firebaseAuthMiddleware } from '../../../shared/middleware/auth.middleware';
import { validateBody } from '../../../shared/middleware/validate.middleware';
import {
  goalCreateSchema,
  correlateActionSchema
} from '../../../shared/validators/schemas';

export const resolverRouter = Router();

resolverRouter.get('/goals',
  firebaseAuthMiddleware,
  ResolverController.listGoals
);

resolverRouter.post('/goals',
  firebaseAuthMiddleware,
  validateBody(goalCreateSchema),
  ResolverController.createGoal
);

resolverRouter.post('/goals/:goalId/reembed',
  firebaseAuthMiddleware,
  ResolverController.reembedGoal
);

resolverRouter.delete('/goals/:goalId',
  firebaseAuthMiddleware,
  ResolverController.deleteGoal
);

resolverRouter.post('/correlate',
  firebaseAuthMiddleware,
  validateBody(correlateActionSchema),
  ResolverController.correlate
);
