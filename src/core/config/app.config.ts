import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.ENV_FILE
  || `env/.env.${process.env.NODE_ENV || 'development'}`;

dotenv.config({ path: path.resolve(process.cwd(), envFile) });

export const appConfig = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8080),
  corsOrigin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : '*'),

  databaseUrl: process.env.DATABASE_URL || '',
  mongoUrl: process.env.MONGO_URL || '',
  mongoDb: process.env.MONGO_DB || 'logoscore_intent',
  redisUrl: process.env.REDIS_URL || '',

  redis: {
    rateLimitStore: (process.env.REDIS_RATE_LIMIT_STORE || 'true').toLowerCase() === 'true'
  },

  memoryBackend: (process.env.MEMORY_BACKEND || 'auto').toLowerCase() as 'auto' | 'mongo' | 'postgres' | 'memory',

  allowAnonymous: (process.env.ALLOW_ANONYMOUS || 'false').toLowerCase() === 'true',

  auth: {
    adminUids: (process.env.ADMIN_UIDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  },

  security: {
    rateLimitEnabled: (process.env.RATE_LIMIT_ENABLED || 'true').toLowerCase() === 'true',
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 120),
    rateLimitAiMax: Number(process.env.RATE_LIMIT_AI_MAX || 20),
    bodyLimit: process.env.BODY_LIMIT || '12mb'
  },

  ai: {
    provider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),
    apiKey: process.env.AI_API_KEY || '',
    modelAnalyze: process.env.AI_MODEL_ANALYZE || 'gemini-1.5-flash',
    modelTts: process.env.AI_MODEL_TTS || 'gemini-2.5-flash-preview-tts',
    modelEmbed: process.env.AI_MODEL_EMBED || 'text-embedding-004',
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1',
    ollamaEmbedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'
  },

  vector: {
    enabled: (process.env.VECTOR_ENABLED || 'true').toLowerCase() === 'true',
    dimensions: Number(process.env.VECTOR_DIMENSIONS || 768),
    topK: Number(process.env.VECTOR_TOP_K || 6)
  },

  resolver: {
    embedModel: process.env.RESOLVER_EMBED_MODEL || 'mxbai-embed-large',
    embedDimensions: Number(process.env.RESOLVER_EMBED_DIM || 1024),
    minScore: Number(process.env.RESOLVER_MIN_SCORE || 0.65),
    topK: Number(process.env.RESOLVER_TOP_K || 5),
    autoCorrelate: (process.env.RESOLVER_AUTO_CORRELATE || 'true').toLowerCase() === 'true',
    parentDiscount: Number(process.env.RESOLVER_PARENT_DISCOUNT || 0.8)
  },

  audit: {
    retentionSeconds: Number(process.env.AUDIT_RETENTION_SECONDS || 60 * 60 * 24 * 90),
    snapshotEvery: Number(process.env.AUDIT_SNAPSHOT_EVERY || 25)
  },

  economizer: {
    enabled: (process.env.ECONOMIZER_ENABLED || 'true').toLowerCase() === 'true',
    embedCacheSize: Number(process.env.ECONOMIZER_EMBED_CACHE_SIZE || 5000),
    synthCacheSize: Number(process.env.ECONOMIZER_SYNTH_CACHE_SIZE || 500),
    cacheTtlSeconds: Number(process.env.ECONOMIZER_CACHE_TTL || 60 * 60 * 24 * 30),
    dedupThreshold: Number(process.env.ECONOMIZER_DEDUP_THRESHOLD || 0.97),
    dedupEnabled: (process.env.ECONOMIZER_DEDUP_ENABLED || 'true').toLowerCase() === 'true',
    batchEnabled: (process.env.ECONOMIZER_BATCH_ENABLED || 'true').toLowerCase() === 'true',
    batchMaxSize: Number(process.env.ECONOMIZER_BATCH_MAX_SIZE || 100),
    redisCacheEnabled: (process.env.ECONOMIZER_REDIS_CACHE_ENABLED || 'true').toLowerCase() === 'true',
    redisCacheTtlSeconds: Number(process.env.ECONOMIZER_REDIS_CACHE_TTL || 60 * 60 * 24)
  },

  telemetry: {
    enabled: (process.env.TELEMETRY_ENABLED || 'false').toLowerCase() === 'true',
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '',
    serviceName: process.env.OTEL_SERVICE_NAME || 'mtaquestwebsidex-backend',
    sampleRate: Number(process.env.OTEL_SAMPLE_RATE || 1.0),
    prometheusEnabled: (process.env.PROMETHEUS_ENABLED || 'false').toLowerCase() === 'true'
  }
} as const;

export type AppConfig = typeof appConfig;
