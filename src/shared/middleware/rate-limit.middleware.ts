import rateLimit, { Options, Store } from 'express-rate-limit';
import { RequestHandler } from 'express';
import { appConfig } from '../../core/config/app.config';
import { AuthenticatedRequest } from './auth.middleware';
import { getRedis } from '../../infrastructure/database/redis';

interface FactoryOpts {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
}

/**
 * Lazy-load `rate-limit-redis`. Trzymamy poza kontraktem importu top-level,
 * bo gdy Redis nie skonfigurowany, paczka też nie musi być wgrana.
 */
let warnedRedisStore = false;
function buildRedisStore(prefix: string): Store | undefined {
  const redis = getRedis();
  if (!redis) return undefined;
  try {
    // require zamiast import — paczka opcjonalna w środowiskach bez Redis.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: RedisStore } = require('rate-limit-redis');
    return new RedisStore({
      sendCommand: (...args: string[]) => (redis as any).call(...args),
      prefix: `rl:${prefix}:`
    });
  } catch (err) {
    if (!warnedRedisStore) {
      warnedRedisStore = true;
      console.warn(`[rate-limit] Redis store init failed: ${(err as Error).message} — fallback to memory store`);
    }
    return undefined;
  }
}

/**
 * Tworzy rate-limit middleware (per-uid; fallback na IP gdy uid='anonymous').
 *
 * Sprint X: jeśli `redis.rateLimitStore && getRedis()` → użyj rate-limit-redis
 * (spójny licznik cross-instance dla Cloud Run min-instances>1).
 * W przeciwnym razie default memory store (single-instance, działa nadal poprawnie).
 *
 * Cloud Armor pełni rolę L4/L7 brzegowej zapory DDoS przed tym warstwowym limiterem.
 *
 * Gdy `security.rateLimitEnabled=false` zwraca no-op.
 */
export function createRateLimit(opts: FactoryOpts = {}): RequestHandler {
  if (!appConfig.security.rateLimitEnabled) {
    return (_req, _res, next) => next();
  }

  const prefix = opts.keyPrefix ?? 'rl';
  const store = appConfig.redis.rateLimitStore ? buildRedisStore(prefix) : undefined;

  const config: Partial<Options> = {
    windowMs: opts.windowMs ?? appConfig.security.rateLimitWindowMs,
    limit: opts.max ?? appConfig.security.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(store ? { store } : {}),
    keyGenerator: (req) => {
      const r = req as AuthenticatedRequest;
      const uid = r.user?.uid;
      // Per-uid dla zalogowanych; anonimów throttlujemy po IP (najmniej fałszywych pozytywów za NAT).
      if (uid && uid !== 'anonymous') {
        return `${prefix}:uid:${uid}`;
      }
      return `${prefix}:ip:${req.ip}`;
    },
    handler: (_req, res) => {
      res.status(429).json({
        error: 'rate_limit_exceeded',
        detail: `max ${config.limit} req per ${config.windowMs}ms`
      });
    }
  };

  return rateLimit(config);
}

/** Globalny limiter dla całego /api (lekki). */
export const globalRateLimit = createRateLimit({ keyPrefix: 'global' });

/** Ostry limiter dla endpointów AI (drogich). */
export const aiRateLimit = createRateLimit({
  max: appConfig.security.rateLimitAiMax,
  keyPrefix: 'ai'
});
