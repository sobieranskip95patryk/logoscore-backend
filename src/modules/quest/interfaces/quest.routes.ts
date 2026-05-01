import { Router } from 'express';
import { QuestController } from './quest.controller';
import { firebaseAuthMiddleware } from '../../../shared/middleware/auth.middleware';
import { validateBody } from '../../../shared/middleware/validate.middleware';
import {
  startQuestSchema,
  rewardQuestSchema,
  branchQuestSchema,
  completeQuestSchema,
  failQuestSchema
} from '../../../shared/validators/schemas';

export const questRouter = Router();

questRouter.post('/start',
  firebaseAuthMiddleware,
  validateBody(startQuestSchema),
  QuestController.start
);

questRouter.post('/branch',
  firebaseAuthMiddleware,
  validateBody(branchQuestSchema),
  QuestController.branch
);

questRouter.post('/complete',
  firebaseAuthMiddleware,
  validateBody(completeQuestSchema),
  QuestController.complete
);

questRouter.post('/fail',
  firebaseAuthMiddleware,
  validateBody(failQuestSchema),
  QuestController.fail
);

questRouter.post('/reward',
  firebaseAuthMiddleware,
  validateBody(rewardQuestSchema),
  QuestController.reward
);

questRouter.get('/:id',
  firebaseAuthMiddleware,
  QuestController.findById
);

questRouter.get('/:id/tree',
  firebaseAuthMiddleware,
  QuestController.tree
);
