import { isMongoReady } from '../../../infrastructure/database/mongo';
import {
  SecurityAuditModel,
  SecurityAction,
  securityAuditExpiry
} from './schemas/security-audit.schema';

export interface SecurityEventInput {
  uid?: string | null;
  action: SecurityAction;
  ip?: string;
  userAgent?: string;
  path?: string;
  method?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}

class SecurityAuditRepository {
  /**
   * Zapis zdarzenia bezpieczeństwa.
   * Tryb miękki: gdy Mongo niedostępny — log na konsolę i no-op (system nie pada).
   */
  async record(input: SecurityEventInput): Promise<void> {
    if (!isMongoReady()) {
      console.warn(`[security-audit:degraded] ${input.action} uid=${input.uid ?? '-'} ${input.reason ?? ''}`);
      return;
    }
    try {
      await SecurityAuditModel.create({
        uid: input.uid ?? null,
        action: input.action,
        ip: input.ip,
        userAgent: input.userAgent,
        path: input.path,
        method: input.method,
        reason: input.reason,
        payload: input.payload,
        expiresAt: securityAuditExpiry(input.action)
      });
    } catch (err) {
      // Audyt nie może blokować ścieżki krytycznej.
      console.error('[security-audit] write failed:', (err as Error).message);
    }
  }

  /**
   * Listowanie zdarzeń (admin only — egzekwowane na warstwie route'a).
   */
  async list(opts: {
    uid?: string;
    action?: SecurityAction;
    from?: string;
    to?: string;
    limit?: number;
  } = {}): Promise<SecurityAuditEntry[]> {
    if (!isMongoReady()) return [];
    const filter: Record<string, unknown> = {};
    if (opts.uid) filter.uid = opts.uid;
    if (opts.action) filter.action = opts.action;
    if (opts.from || opts.to) {
      const range: Record<string, Date> = {};
      if (opts.from) range.$gte = new Date(opts.from);
      if (opts.to) range.$lte = new Date(opts.to);
      filter.createdAt = range;
    }
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const docs = await SecurityAuditModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    return docs.map((d) => ({
      uid: d.uid ?? null,
      action: d.action,
      ip: d.ip,
      userAgent: d.userAgent,
      path: d.path,
      method: d.method,
      reason: d.reason,
      payload: d.payload,
      createdAt: (d.createdAt as Date).toISOString()
    }));
  }
}

export interface SecurityAuditEntry {
  uid: string | null;
  action: SecurityAction;
  ip?: string;
  userAgent?: string;
  path?: string;
  method?: string;
  reason?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export const securityAuditRepository = new SecurityAuditRepository();
