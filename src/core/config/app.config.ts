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

  /** Sprint X — globalne flagi dla rozproszonych warstw Redis. */
  redis: {
    /** Użyj rate-limit-redis jako store dla express-rate-limit (cross-instance). */
    rateLimitStore: (process.env.REDIS_RATE_LIMIT_STORE || 'true').toLowerCase() === 'true'
  },

  memoryBackend: (process.env.MEMORY_BACKEND || 'auto').toLowerCase() as 'auto' | 'mongo' | 'postgres' | 'memory',

  allowAnonymous: (process.env.ALLOW_ANONYMOUS || 'false').toLowerCase() === 'true',

  auth: {
    /**
     * Lista UID-ów (CSV) którym przypisujemy role 'admin' niezależnie od custom claims Firebase.
     * Używana awaryjnie zanim wdrożymy `auth.setCustomUserClaims({role:'admin'})` po stronie GCP.
     */
    adminUids: (process.env.ADMIN_UIDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  },

  security: {
    /** Globalny włącznik rate-limit (Cloud Armor jest dodatkową warstwą L7 w GCP). */
    rateLimitEnabled: (process.env.RATE_LIMIT_ENABLED || 'true').toLowerCase() === 'true',
    /** Domyślne okno (ms). */
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    /** Domyślny limit żądań w oknie (per-uid lub per-IP gdy uid='anonymous'). */
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 120),
    /** Limit dla endpointów AI (analyze/synthesize/embed) — droższe, ostrzejszy próg. */
    rateLimitAiMax: Number(process.env.RATE_LIMIT_AI_MAX || 20),
    /** Maksymalny rozmiar payloadu JSON na endpointach REST. */
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
    /** Model wektorowy dla celów/akcji — większa gęstość informacyjna niż domyślny embed. */
    embedModel: process.env.RESOLVER_EMBED_MODEL || 'mxbai-embed-large',
    embedDimensions: Number(process.env.RESOLVER_EMBED_DIM || 1024),
    /** Próg korelacji — poniżej tej wartości nie zwracamy matchów. */
    minScore: Number(process.env.RESOLVER_MIN_SCORE || 0.65),
    topK: Number(process.env.RESOLVER_TOP_K || 5),
    /** Auto-korelacja po każdej analizie LOGOS. */
    autoCorrelate: (process.env.RESOLVER_AUTO_CORRELATE || 'true').toLowerCase() === 'true',
    /** Dyskont propagacji do celów nadrzędnych przez parentId (0..1). */
    parentDiscount: Number(process.env.RESOLVER_PARENT_DISCOUNT || 0.8)
  },
  audit: {
    /** Retencja wpisów intent_audit (sek). Snapshoty omijają TTL. */
    retentionSeconds: Number(process.env.AUDIT_RETENTION_SECONDS || 60 * 60 * 24 * 90),
    /** Co ile mutacji wymuszać auto-snapshot (0 = wyłączone). */
    snapshotEvery: Number(process.env.AUDIT_SNAPSHOT_EVERY || 25)
  },
  economizer: {
    /** Globalny włącznik Token Economizera (Sprint IX). */
    enabled: (process.env.ECONOMIZER_ENABLED || 'true').toLowerCase() === 'true',
    /** Pojemność LRU cache dla embeddingów (in-mem). */
    embedCacheSize: Number(process.env.ECONOMIZER_EMBED_CACHE_SIZE || 5000),
    /** Pojemność LRU cache dla syntez (in-mem). */
    synthCacheSize: Number(process.env.ECONOMIZER_SYNTH_CACHE_SIZE || 500),
    /** TTL dla persystentnego cache embed/synth w Mongo (sek). */
    cacheTtlSeconds: Number(process.env.ECONOMIZER_CACHE_TTL || 60 * 60 * 24 * 30),
    /** Próg cosine similarity dla semantic dedup (0..1). >= próg → reuse. */
    dedupThreshold: Number(process.env.ECONOMIZER_DEDUP_THRESHOLD || 0.97),
    /** Czy włączyć semantic dedup w embeddingRepository.ingest. */
    dedupEnabled: (process.env.ECONOMIZER_DEDUP_ENABLED || 'true').toLowerCase() === 'true',
    /** Sprint X: użyj batchEmbed providera w ingestMany / executeService.embedBatch. */
    batchEnabled: (process.env.ECONOMIZER_BATCH_ENABLED || 'true').toLowerCase() === 'true',
    /** Maksymalna liczba textów na 1 batch embed (Gemini API limit ~100). */
    batchMaxSize: Number(process.env.ECONOMIZER_BATCH_MAX_SIZE || 100),
    /** Sprint X: użyj Redis jako L1 cache (synergiczne z LRU — Redis ma priorytet gdy dostępny). */
    redisCacheEnabled: (process.env.ECONOMIZER_REDIS_CACHE_ENABLED || 'true').toLowerCase() === 'true',
    /** TTL dla Redis L1 (sek). Krótsze niż Mongo L2 — Redis to gorąca pamięć. */
    redisCacheTtlSeconds: Number(process.env.ECONOMIZER_REDIS_CACHE_TTL || 60 * 60 * 24)
  },

  /** Sprint XI — Observability Mesh: OpenTelemetry + health deep-probe. */
  telemetry: {
    /** Master switch — gdy false, init OTel jest no-op (zerowy overhead). */
    enabled: (process.env.TELEMETRY_ENABLED || 'false').toLowerCase() === 'true',
    /** OTLP HTTP endpoint (Cloud Trace via OTel collector lub Tempo/Jaeger). */
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '',
    /** Nazwa serwisu w span attributes / Resource. */
    serviceName: process.env.OTEL_SERVICE_NAME || 'mtaquestwebsidex-backend',
    /** Sample rate 0..1 (1.0 = 100% spanów; produkcja typowo 0.05–0.1). */
    sampleRate: Number(process.env.OTEL_SAMPLE_RATE || 1.0),
    /** Eksport metrycznych snapshotów economizera w Prometheus exposition format. */
    prometheusEnabled: (process.env.PROMETHEUS_ENABLED || 'false').toLowerCase() === 'true'
  }
} as const;

export type AppConfig = typeof appConfig;
