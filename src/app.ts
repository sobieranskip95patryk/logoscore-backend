import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { json } from 'body-parser';

import { appConfig } from './core/config/app.config';
import { initializeFirebase } from './core/config/firebase.config';
import { registerRoutes } from './routes';
import { eventBus } from './core/events/event-bus';
import { errorHandler } from './shared/middleware/error.middleware';
import { requestIdMiddleware } from './shared/middleware/request-id.middleware';
import { requestLogger } from './shared/middleware/request-logger.middleware';

/**
 * Production safety guard.
 * `ALLOW_ANONYMOUS=true` w prod = krytyczna luka — wyłączamy możliwość
 * uruchomienia rdzenia w takim trybie. Wymaga jawnego SECURITY_OVERRIDE
 * dla kontrolowanych testów demo.
 */
function assertProductionSafety(): void {
  const isProd = appConfig.env === 'production';
  if (isProd && appConfig.allowAnonymous && process.env.SECURITY_OVERRIDE !== 'allow_anonymous_in_prod') {
    throw new Error(
      '[security] FATAL: ALLOW_ANONYMOUS=true is forbidden in production. ' +
      'Set ALLOW_ANONYMOUS=false (or SECURITY_OVERRIDE=allow_anonymous_in_prod for explicit demo override).'
    );
  }
  if (isProd && appConfig.corsOrigin === '*') {
    throw new Error('[security] FATAL: CORS_ORIGIN=* is forbidden in production. Set explicit allowlist.');
  }
}

export function createApp(): Express {
  assertProductionSafety();

  const app = express();
  // Trust pierwszy proxy (Cloud Run / nginx / Cloudflare) — req.ip oddaje X-Forwarded-For[0].
  app.set('trust proxy', 1);

  initializeFirebase();

  app.use(requestIdMiddleware);
  app.use(requestLogger);
  app.use(helmet());
  app.use(cors({ origin: appConfig.corsOrigin, credentials: true }));
  app.use(json({ limit: appConfig.security.bodyLimit }));

  app.locals.eventBus = eventBus;

  registerRoutes(app);

  app.use(errorHandler);

  return app;
}
