import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, UserRole } from './auth.middleware';

/**
 * Wymaga że `req.user.role` należy do listy `allowed`.
 * Zwraca 401 gdy brak auth, 403 gdy rola nie pasuje.
 *
 * Przykład:
 *   router.get('/admin/audit', firebaseAuthMiddleware, requireRole('admin'), handler)
 */
export function requireRole(...allowed: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({
        error: 'forbidden',
        detail: `requires one of: ${allowed.join(', ')}`,
        actualRole: req.user.role
      });
      return;
    }
    next();
  };
}

/**
 * Odrzuca anonimowych użytkowników (nawet gdy ALLOW_ANONYMOUS=true).
 * Stosować na endpointach wrażliwych (RODO, audyt, mutacje finansowe itp.).
 */
export function requireAuthenticated(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user || req.user.anonymous) {
    res.status(401).json({ error: 'authenticated_account_required' });
    return;
  }
  next();
}
