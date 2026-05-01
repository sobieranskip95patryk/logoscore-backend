import { Request, Response, NextFunction } from 'express';
import { firebaseAuth } from '../../core/config/firebase.config';
import { appConfig } from '../../core/config/app.config';

export type UserRole = 'admin' | 'user' | 'system';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    anonymous: boolean;
    email?: string;
    role: UserRole;
  };
}

/**
 * Wyznacza rolę użytkownika.
 * Priorytet: custom claim Firebase `role` → lista `auth.adminUids` z env → 'user'.
 * Anonim zawsze 'user' (rolę 'admin' można nadać tylko zweryfikowanym kontom).
 */
function resolveRole(uid: string, anonymous: boolean, claimRole?: unknown): UserRole {
  if (anonymous) return 'user';
  if (claimRole === 'admin' || claimRole === 'system') return claimRole;
  if (appConfig.auth.adminUids.includes(uid)) return 'admin';
  return 'user';
}

/**
 * Bearer token middleware (Firebase ID Token).
 * Tryb miękki: gdy Firebase Admin nie jest skonfigurowany, akceptujemy
 * token jako sessionId (anonimowy), żeby frontend HTML działał lokalnie.
 */
export async function firebaseAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.header('authorization') || req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) {
    if (appConfig.allowAnonymous) {
      req.user = { uid: 'anonymous', anonymous: true, role: 'user' };
      return next();
    }
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }

  const auth = firebaseAuth();
  if (!auth) {
    if (appConfig.env === 'production') {
      res.status(500).json({
        error: 'firebase_auth_not_configured',
        detail: 'Firebase Admin must be configured in production.'
      });
      return;
    }
    const uid = token.slice(0, 64);
    req.user = { uid, anonymous: true, role: resolveRole(uid, true) };
    return next();
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    const anonymous = decoded.firebase?.sign_in_provider === 'anonymous';
    req.user = {
      uid: decoded.uid,
      anonymous,
      email: decoded.email,
      role: resolveRole(decoded.uid, anonymous, (decoded as Record<string, unknown>).role)
    };
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid token', detail: (err as Error).message });
  }
}
