import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';

type Source = 'body' | 'query' | 'params';

/**
 * Wymaga że pole `field` w `source` (body/query/params) jest równe `req.user.uid`.
 * Wyjątek: użytkownicy z rolą 'admin' lub 'system' przechodzą bez sprawdzenia.
 *
 * Cel: zamknięcie horyzontalnej eskalacji uprawnień — klient nie może
 * podać cudzego sessionId/userId i czytać/mutować jego stanu.
 *
 * Przykład:
 *   router.post('/snapshot', firebaseAuthMiddleware, requireOwnership('body', 'sessionId'), handler)
 */
export function requireOwnership(source: Source, field: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    if (req.user.role === 'admin' || req.user.role === 'system') {
      return next();
    }
    const container = (req as unknown as Record<Source, Record<string, unknown> | undefined>)[source];
    const provided = container?.[field];
    // Brak pola → traktujemy jak "domyślnie ja" (kontrolery i tak fallbackują na req.user.uid).
    if (provided === undefined || provided === null || provided === '') {
      return next();
    }
    if (String(provided) !== req.user.uid) {
      res.status(403).json({
        error: 'forbidden_ownership',
        detail: `${source}.${field} must equal authenticated uid`
      });
      return;
    }
    next();
  };
}
