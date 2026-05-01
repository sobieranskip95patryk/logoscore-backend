import Redis from 'ioredis';
import { appConfig } from '../../core/config/app.config';

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!appConfig.redisUrl) return null;
  if (client) return client;
  client = new Redis(appConfig.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2
  });
  client.on('error', (err) => console.error('[redis] error:', err.message));
  client.connect().catch((e) => console.error('[redis] connect failed:', e.message));
  return client;
}

export async function pingRedis(): Promise<boolean> {
  const c = getRedis();
  if (!c) return false;
  try {
    const pong = await c.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
