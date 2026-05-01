import { Schema, model, models, Document, Model } from 'mongoose';
import { appConfig } from '../../../../core/config/app.config';

/**
 * Intent Schema — pierwszy model Living Memory.
 *
 * Mapa intencji jako graf JSON-LD:
 *  - jeden dokument na sessionId
 *  - nodes/edges trzymane natywnie jako tablice subdokumentów (Mongo blasts here)
 *  - vocab @context zgodny z naszą domeną (mtaquestwebsidex.app)
 *
 * Audit: każda mutacja (append/replace) generuje wpis w IntentAudit (append-only).
 */

export interface IntentNodeDoc {
  '@id': string;
  '@type': 'Intent';
  text: string;
  weight: number;
  embeddingRef?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface IntentEdgeDoc {
  '@id': string;
  '@type': 'IntentLink';
  from: string;
  to: string;
  weight: number;
  reason?: string;
  createdAt: Date;
}

export interface IntentDocument extends Document {
  sessionId: string;
  uid?: string | null;
  context: {
    '@vocab': string;
    Intent: string;
    IntentLink: string;
  };
  '@id': string;
  nodes: IntentNodeDoc[];
  edges: IntentEdgeDoc[];
  version: number;
  updatedAt: Date;
  createdAt: Date;
}

const IntentNodeSchema = new Schema<IntentNodeDoc>({
  '@id': { type: String, required: true },
  '@type': { type: String, enum: ['Intent'], default: 'Intent' },
  text: { type: String, required: true, maxlength: 4000 },
  weight: { type: Number, default: 1.0 },
  embeddingRef: { type: String },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: () => new Date() }
}, { _id: false });

const IntentEdgeSchema = new Schema<IntentEdgeDoc>({
  '@id': { type: String, required: true },
  '@type': { type: String, enum: ['IntentLink'], default: 'IntentLink' },
  from: { type: String, required: true },
  to: { type: String, required: true },
  weight: { type: Number, default: 0.8 },
  reason: { type: String },
  createdAt: { type: Date, default: () => new Date() }
}, { _id: false });

const IntentSchema = new Schema<IntentDocument>({
  sessionId: { type: String, required: true, unique: true, index: true },
  uid: { type: String, default: null, index: true },
  context: {
    '@vocab':    { type: String, default: 'https://mtaquestwebsidex.app/vocab#' },
    Intent:      { type: String, default: 'https://mtaquestwebsidex.app/vocab#Intent' },
    IntentLink:  { type: String, default: 'https://mtaquestwebsidex.app/vocab#IntentLink' }
  },
  '@id': { type: String, required: true },
  nodes: { type: [IntentNodeSchema], default: [] },
  edges: { type: [IntentEdgeSchema], default: [] },
  version: { type: Number, default: 1 }
}, {
  timestamps: true,
  collection: 'intent_graphs',
  minimize: false
});

IntentSchema.index({ uid: 1, updatedAt: -1 });
IntentSchema.index({ 'nodes.@id': 1 });

export const IntentModel: Model<IntentDocument> =
  (models.Intent as Model<IntentDocument>) ||
  model<IntentDocument>('Intent', IntentSchema);

/* ------------------------------------------------------------------ */
/*  Append-only audit                                                  */
/* ------------------------------------------------------------------ */

export interface IntentAuditDoc extends Document {
  sessionId: string;
  uid?: string | null;
  action: 'create' | 'append' | 'replace' | 'snapshot' | 'delete';
  fragment?: string;
  payload?: Record<string, unknown>;
  versionBefore?: number;
  versionAfter?: number;
  /** Data wygaśnięcia (TTL). Snapshoty mają undefined → nie są czyszczone. */
  expiresAt?: Date | null;
  createdAt: Date;
}

const IntentAuditSchema = new Schema<IntentAuditDoc>({
  sessionId: { type: String, required: true, index: true },
  uid: { type: String, default: null, index: true },
  action: { type: String, required: true, enum: ['create', 'append', 'replace', 'snapshot', 'delete'] },
  fragment: { type: String },
  payload: { type: Schema.Types.Mixed },
  versionBefore: { type: Number },
  versionAfter: { type: Number },
  expiresAt: { type: Date, default: null }
}, {
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'intent_audit',
  capped: false
});

IntentAuditSchema.index({ sessionId: 1, createdAt: -1 });
// TTL na wpisach z ustawionym expiresAt; snapshoty (expiresAt=null) zostają wieczne.
IntentAuditSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Helper: zwraca datę wygaśnięcia dla danej akcji (null → brak TTL). */
export function auditExpiryFor(action: IntentAuditDoc['action']): Date | null {
  if (action === 'snapshot') return null;
  return new Date(Date.now() + appConfig.audit.retentionSeconds * 1000);
}

export const IntentAuditModel: Model<IntentAuditDoc> =
  (models.IntentAudit as Model<IntentAuditDoc>) ||
  model<IntentAuditDoc>('IntentAudit', IntentAuditSchema);
