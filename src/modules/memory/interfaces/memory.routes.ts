import { Router } from 'express';
import { MemoryController } from './memory.controller';
import { firebaseAuthMiddleware } from '../../../shared/middleware/auth.middleware';
import { validateBody } from '../../../shared/middleware/validate.middleware';
import { requireOwnership } from '../../../shared/middleware/ownership.middleware';
import { aiRateLimit } from '../../../shared/middleware/rate-limit.middleware';
import { intentMapUpdateSchema } from '../../../shared/validators/schemas';

export const memoryRouter = Router();

memoryRouter.get('/intent-map',
  firebaseAuthMiddleware,
  requireOwnership('query', 'sessionId'),
  MemoryController.getIntentMap
);

memoryRouter.get('/intent-graph',
  firebaseAuthMiddleware,
  requireOwnership('query', 'sessionId'),
  MemoryController.getIntentGraph
);

memoryRouter.post('/intent-map/update',
  firebaseAuthMiddleware,
  validateBody(intentMapUpdateSchema),
  requireOwnership('body', 'sessionId'),
  MemoryController.updateIntentMap
);

memoryRouter.post('/snapshot',
  firebaseAuthMiddleware,
  requireOwnership('body', 'sessionId'),
  MemoryController.snapshot
);

memoryRouter.get('/snapshots',
  firebaseAuthMiddleware,
  requireOwnership('query', 'sessionId'),
  MemoryController.listSnapshots
);

memoryRouter.post('/ingest',
  firebaseAuthMiddleware,
  aiRateLimit,
  requireOwnership('body', 'sessionId'),
  MemoryController.ingestDocument
);

memoryRouter.post('/search',
  firebaseAuthMiddleware,
  aiRateLimit,
  requireOwnership('body', 'sessionId'),
  MemoryController.search
);
