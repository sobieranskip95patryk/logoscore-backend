import { Schema, model, models, Document, Model } from 'mongoose';

/**
 * Sprint IX — persistent cache embeddingów / syntezy.
 * Klucz to sha256(model::canonicalize(text)). TTL via expiresAt index.
 * `kind` rozdziela embed/synth żeby nie potrzeba było drugiej kolekcji.
 */
export type CacheKind = 'embed' | 'synth';

export interface AiCacheDoc extends Document {
  key: string;
  kind: CacheKind;
  modelName: string;
  textPreview: string;       // pierwsze 120 znaków — debug + diagnostyka
  payload: unknown;          // EmbedOutput | SynthesizeOutput (cały obiekt)
  hits: number;
  expiresAt: Date;
  createdAt: Date;
}

const AiCacheSchema = new Schema<AiCacheDoc>({
  key: { type: String, required: true, unique: true, index: true },
  kind: { type: String, required: true, enum: ['embed', 'synth'], index: true },
  modelName: { type: String, required: true },
  textPreview: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  hits: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true }
}, {
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'ai_cache'
});

AiCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AiCacheSchema.index({ kind: 1, modelName: 1, hits: -1 });

export const AiCacheModel: Model<AiCacheDoc> =
  (models.AiCache as Model<AiCacheDoc>) || model<AiCacheDoc>('AiCache', AiCacheSchema);
