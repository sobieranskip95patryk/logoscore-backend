/**
 * Sprint IX — repository persystentnego cache AI.
 * Graceful: jeśli Mongo offline, wszystkie operacje są no-op (warn jednorazowy).
 */
import mongoose from 'mongoose';
import { AiCacheModel, CacheKind } from './ai-cache.schema';
import { appConfig } from '../../../core/config/app.config';

let warnedOffline = false;
function isMongoReady(): boolean {
  if (mongoose.connection.readyState === 1) return true;
  if (!warnedOffline) {
    console.warn('[economizer] Mongo not ready — persistent cache disabled (in-mem LRU still active)');
    warnedOffline = true;
  }
  return false;
}

export interface CachedEntry<T = unknown> {
  payload: T;
  hits: number;
}

export const aiCacheRepository = {
  async get<T>(key: string): Promise<CachedEntry<T> | null> {
    if (!isMongoReady()) return null;
    try {
      const doc = await AiCacheModel.findOneAndUpdate(
        { key, expiresAt: { $gt: new Date() } },
        { $inc: { hits: 1 } },
        { new: true, lean: true }
      );
      if (!doc) return null;
      return { payload: doc.payload as T, hits: doc.hits };
    } catch (err) {
      console.warn('[economizer] cache.get failed:', (err as Error).message);
      return null;
    }
  },

  async put<T>(key: string, kind: CacheKind, modelName: string, textPreview: string, payload: T): Promise<void> {
    if (!isMongoReady()) return;
    try {
      const expiresAt = new Date(Date.now() + appConfig.economizer.cacheTtlSeconds * 1000);
      await AiCacheModel.updateOne(
        { key },
        {
          $set: { kind, modelName, textPreview: textPreview.slice(0, 120), payload, expiresAt },
          $setOnInsert: { hits: 0 }
        },
        { upsert: true }
      );
    } catch (err) {
      console.warn('[economizer] cache.put failed:', (err as Error).message);
    }
  },

  async stats(): Promise<{ embed: number; synth: number; topHits: Array<{ key: string; hits: number; model: string }> }> {
    if (!isMongoReady()) return { embed: 0, synth: 0, topHits: [] };
    try {
      const [embed, synth, topHits] = await Promise.all([
        AiCacheModel.countDocuments({ kind: 'embed' }),
        AiCacheModel.countDocuments({ kind: 'synth' }),
        AiCacheModel.find({}, { key: 1, hits: 1, modelName: 1 }).sort({ hits: -1 }).limit(10).lean()
      ]);
      return {
        embed,
        synth,
        topHits: topHits.map(d => ({ key: d.key, hits: d.hits, model: d.modelName }))
      };
    } catch {
      return { embed: 0, synth: 0, topHits: [] };
    }
  }
};
