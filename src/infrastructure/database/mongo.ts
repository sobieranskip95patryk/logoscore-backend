import mongoose, { Connection } from 'mongoose';
import { appConfig } from '../../core/config/app.config';

let conn: Connection | null = null;
let connecting: Promise<Connection | null> | null = null;
let available = false;

/**
 * Living Memory — Mongo 7 (lokal docker) lub Atlas (prod).
 * Lazy connect: pierwsze wywołanie inicjuje połączenie.
 * Brak MONGO_URL ⇒ moduł zwraca null i adapter degraduje do Postgres/in-memory.
 */
export async function getMongo(): Promise<Connection | null> {
  if (!appConfig.mongoUrl) return null;
  if (conn) return conn;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const m = await mongoose.connect(appConfig.mongoUrl, {
        dbName: appConfig.mongoDb,
        serverSelectionTimeoutMS: 3000,
        maxPoolSize: 20
      });
      conn = m.connection;
      available = true;
      conn.on('error', (err) => console.error('[mongo] error:', err.message));
      conn.on('disconnected', () => { available = false; });
      console.log(`[mongo] connected: ${appConfig.mongoDb}`);
      return conn;
    } catch (e) {
      console.warn('[mongo] connection failed, degrading:', (e as Error).message);
      available = false;
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

export function isMongoReady(): boolean { return available; }

export async function pingMongo(): Promise<boolean> {
  const c = await getMongo();
  if (!c) return false;
  try {
    const res = await c.db?.admin().ping();
    return res?.ok === 1;
  } catch {
    return false;
  }
}

export async function closeMongo(): Promise<void> {
  if (conn) {
    await mongoose.disconnect();
    conn = null;
    available = false;
  }
}
