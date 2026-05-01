# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Sprint XII — Cloud Run Hardening: Distroless + non-root + multi-stage
#
# Etapy:
#   deps     → instaluje WSZYSTKIE zależności (dev+prod) potrzebne do `tsc`.
#   builder  → kompiluje TypeScript do dist/ + przycina deps do produkcji.
#   runtime  → distroless/nonroot, tylko `node` + dist + node_modules.
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=20.15.1
ARG DISTROLESS_TAG=nodejs20-debian12:nonroot

# ── Stage 1: deps (full install) ────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ── Stage 2: builder (TypeScript → dist/) ───────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app
ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json
# Przytnij do produkcyjnych zależności (zachowuje plik-lock).
RUN --mount=type=cache,target=/root/.npm \
    npm prune --omit=dev

# ── Stage 3: runtime (distroless, non-root) ─────────────────────────────────
FROM gcr.io/distroless/${DISTROLESS_TAG} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    NODE_OPTIONS=--enable-source-maps

# OCI labels — observability na poziomie obrazu.
LABEL org.opencontainers.image.title="logoscore-backend" \
    org.opencontainers.image.description="LOGOS V5.3 Universal — backend (LogosCore)." \
    org.opencontainers.image.source="https://github.com/MTAQuestWebsideX/logoscore-backend" \
    org.opencontainers.image.licenses="UNLICENSED" \
    org.opencontainers.image.vendor="MTAQuestWebsideX"

COPY --from=builder --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /app/dist ./dist
COPY --from=builder --chown=nonroot:nonroot /app/package.json ./package.json

USER nonroot
EXPOSE 8080

# Distroless nodejs ma `node` jako ENTRYPOINT — przekazujemy tylko skrypt.
CMD ["dist/server.js"]
