import http from 'http';
// Sprint XI: telemetry init MUSI być pierwszą rzeczywistą operacją —
// auto-instrumentacja patchuje moduły wymagane później.
import { initTelemetry } from './infrastructure/observability/telemetry';
initTelemetry();

import { createApp } from './app';
import { appConfig } from './core/config/app.config';
import { eventBus } from './core/events/event-bus';
import { createSocketGateway } from './infrastructure/websocket/socket.gateway';
import { pingPostgres } from './infrastructure/database/postgres';
import { pingRedis } from './infrastructure/database/redis';
import { pingMongo, closeMongo } from './infrastructure/database/mongo';
import { installQuestResolverBridge } from './modules/resolver/application/quest-bridge';
import { SYSTEM_NAME, SYSTEM_VERSION } from './shared/constants';

async function bootstrap() {
  const app = createApp();
  const server = http.createServer(app);

  createSocketGateway(server, eventBus);

  // Best-effort: schemat bazy danych jeśli Postgres skonfigurowany.
  try {
    if (await pingPostgres()) {
      console.log('[postgres] connected');
    } else if (appConfig.databaseUrl) {
      console.warn('[postgres] DATABASE_URL set but ping failed — using in-memory fallback');
    } else {
      console.log('[postgres] no DATABASE_URL — using in-memory storage');
    }
  } catch (e) {
    console.error('[postgres] connection check failed:', (e as Error).message);
  }

  if (await pingRedis()) {
    console.log('[redis] connected');
  } else if (appConfig.redisUrl) {
    console.warn('[redis] REDIS_URL set but ping failed');
  }

  if (await pingMongo()) {
    console.log('[mongo] living memory online');
  } else if (appConfig.mongoUrl) {
    console.warn('[mongo] MONGO_URL set but ping failed — degrading to Postgres for intent map');
  }

  installQuestResolverBridge();

  // 🔥 KLUCZOWA ZMIANA: port z ENV / 8080
  const PORT = appConfig.port || Number(process.env.PORT) || 8080;

  server.listen(PORT, '0.0.0.0', () => {
    eventBus.publish('system.boot', {
      service: SYSTEM_NAME,
      version: SYSTEM_VERSION,
      env: appConfig.env,
      port: PORT,
      status: 'online'
    });
    console.log(
      `\n  ${SYSTEM_NAME} v${SYSTEM_VERSION} active on port ${PORT}\n` +
      `  env=${appConfig.env}  ai=${appConfig.ai.provider}  coherence=P=1.0\n`
    );
  });

  const shutdown = (signal: string) => {
    console.log(`\n[${signal}] shutting down...`);
    eventBus.publish('system.shutdown', { signal });
    closeMongo().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[bootstrap] fatal:', err);
  process.exit(1);
});
