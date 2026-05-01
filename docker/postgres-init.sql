-- Auto-init dla Postgres 16 w docker-compose.
-- Włącza pgvector od razu, by ensureSchema() znalazł rozszerzenie gotowe.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
