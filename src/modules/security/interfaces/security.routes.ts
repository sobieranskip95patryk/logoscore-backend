import { Router } from 'express';
import { SecurityController } from './security.controller';
import { firebaseAuthMiddleware } from '../../../shared/middleware/auth.middleware';
import { requireAuthenticated, requireRole } from '../../../shared/middleware/rbac.middleware';

/**
 * Endpointy RODO/GDPR — dostępne dla zalogowanego (nie-anonima) użytkownika.
 * Anonim nie ma czego eksportować/usuwać poza ulotnymi danymi sesji.
 */
export const meRouter = Router();

meRouter.get('/export',
  firebaseAuthMiddleware,
  requireAuthenticated,
  SecurityController.exportMe
);

meRouter.delete('/',
  firebaseAuthMiddleware,
  requireAuthenticated,
  SecurityController.deleteMe
);

/**
 * Endpointy administracyjne — wymagają roli 'admin'.
 */
export const adminRouter = Router();

adminRouter.get('/security/audit',
  firebaseAuthMiddleware,
  requireRole('admin'),
  SecurityController.listAudit
);
