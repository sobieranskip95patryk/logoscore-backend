import { Schema, model, models, Document, Model } from 'mongoose';
import { appConfig } from '../../../../core/config/app.config';

/**
 * Append-only security audit log.
 *
 * Cel: wszystkie zdarzenia bezpieczeństwa (auth success/failure, rate-limit,
 * forbidden, RODO export/delete) trafiają tu z TTL = `audit.retentionSeconds`.
 * Snapshoty pozostają wieczne (RODO art. 30 — rejestr czynności przetwarzania).
 */

export type SecurityAction =
  | 'auth.success'
  | 'auth.failure'
  | 'rate_limited'
  | 'forbidden'
  | 'user.exported'
  | 'user.deleted';

export interface SecurityAuditDoc extends Document {
  uid: string | null;
  action: SecurityAction;
  ip?: string;
  userAgent?: string;
  path?: string;
  method?: string;
  reason?: string;
  payload?: Record<string, unknown>;
  /** TTL — zdarzenia operacyjne wygasają, RODO trzymamy bez TTL (expiresAt=null). */
  expiresAt?: Date | null;
  createdAt: Date;
}

const SecurityAuditSchema = new Schema<SecurityAuditDoc>({
  uid: { type: String, default: null, index: true },
  action: {
    type: String,
    required: true,
    index: true,
    enum: ['auth.success', 'auth.failure', 'rate_limited', 'forbidden', 'user.exported', 'user.deleted']
  },
  ip: { type: String },
  userAgent: { type: String },
  path: { type: String },
  method: { type: String },
  reason: { type: String },
  payload: { type: Schema.Types.Mixed },
  expiresAt: { type: Date, default: null }
}, {
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'security_audit'
});

SecurityAuditSchema.index({ uid: 1, createdAt: -1 });
SecurityAuditSchema.index({ action: 1, createdAt: -1 });
SecurityAuditSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Akcje RODO (export/delete) — wieczyste; pozostałe — TTL operacyjne.
 */
export function securityAuditExpiry(action: SecurityAction): Date | null {
  if (action === 'user.exported' || action === 'user.deleted') return null;
  return new Date(Date.now() + appConfig.audit.retentionSeconds * 1000);
}

export const SecurityAuditModel: Model<SecurityAuditDoc> =
  (models.SecurityAudit as Model<SecurityAuditDoc>) ||
  model<SecurityAuditDoc>('SecurityAudit', SecurityAuditSchema);
