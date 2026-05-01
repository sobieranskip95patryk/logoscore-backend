import { Socket } from 'socket.io';
import { firebaseAuth } from '../../core/config/firebase.config';
import { appConfig } from '../../core/config/app.config';
import { UserRole } from '../middleware/auth.middleware';
import { securityAuditRepository } from '../../modules/security/infrastructure/security-audit.repository';
import { eventBus } from '../../core/events/event-bus';

export interface SocketUser {
  uid: string;
  anonymous: boolean;
  role: UserRole;
  email?: string;
}

interface AuthedSocket extends Socket {
  data: Socket['data'] & { user?: SocketUser };
}

function resolveRole(uid: string, anonymous: boolean, claimRole?: unknown): UserRole {
  if (anonymous) return 'user';
  if (claimRole === 'admin' || claimRole === 'system') return claimRole;
  if (appConfig.auth.adminUids.includes(uid)) return 'admin';
  return 'user';
}

/**
 * Socket.IO middleware — weryfikuje token z `socket.handshake.auth.token`
 * (lub z headera `Authorization: Bearer ...`), zapisuje user na `socket.data.user`.
 *
 * Reguły:
 *   - brak tokenu + ALLOW_ANONYMOUS=true → SocketUser anonim
 *   - brak tokenu + ALLOW_ANONYMOUS=false → next(Error) → handshake odrzucony
 *   - Firebase Admin niedostępny (soft mode) → uid = token.slice(0,64), anonymous=true
 *   - błąd weryfikacji → audyt + Error
 */
export async function socketAuthMiddleware(
  socket: AuthedSocket,
  next: (err?: Error) => void
): Promise<void> {
  const handshakeAuth = socket.handshake.auth as { token?: string } | undefined;
  const headerAuth = socket.handshake.headers.authorization;
  const headerToken = headerAuth?.startsWith('Bearer ') ? headerAuth.slice(7) : undefined;
  const token = handshakeAuth?.token || headerToken;

  if (!token) {
    if (appConfig.allowAnonymous) {
      socket.data.user = { uid: 'anonymous', anonymous: true, role: 'user' };
      return next();
    }
    await securityAuditRepository.record({
      action: 'auth.failure',
      ip: socket.handshake.address,
      reason: 'ws_missing_token',
      userAgent: String(socket.handshake.headers['user-agent'] || '')
    });
    return next(new Error('ws_missing_token'));
  }

  const auth = firebaseAuth();
  if (!auth) {
    const uid = token.slice(0, 64);
    socket.data.user = { uid, anonymous: true, role: resolveRole(uid, true) };
    return next();
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    const anonymous = decoded.firebase?.sign_in_provider === 'anonymous';
    socket.data.user = {
      uid: decoded.uid,
      anonymous,
      email: decoded.email,
      role: resolveRole(decoded.uid, anonymous, (decoded as Record<string, unknown>).role)
    };
    eventBus.publish('security.auth.success', {
      uid: decoded.uid, channel: 'ws', socketId: socket.id
    });
    next();
  } catch (err) {
    await securityAuditRepository.record({
      action: 'auth.failure',
      ip: socket.handshake.address,
      reason: 'ws_invalid_token',
      payload: { detail: (err as Error).message }
    });
    next(new Error('ws_invalid_token'));
  }
}

/**
 * Sprawdza że uid socketu może subskrybować pokój `session:<sessionId>`.
 * Zasada: anonim → tylko `session:<own-uid>`; zalogowany → `session:<own-uid>` lub `session:<own-uid>:*`;
 * admin/system → dowolne.
 *
 * Zamyka eskalację horyzontalną na warstwie WS — klient nie może podsłuchać
 * cudzej sesji nawet jeśli zna jej id.
 */
export function canJoinRoom(user: SocketUser | undefined, sessionId: string): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'system') return true;
  if (!sessionId) return false;
  return sessionId === user.uid || sessionId.startsWith(`${user.uid}:`);
}
