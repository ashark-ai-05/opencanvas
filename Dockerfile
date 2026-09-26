# Multi-stage build for the Railway demo. Produces a slim runtime
# image: pnpm + Node 24 + the built backend + the built Vite SPA.
#
# Stages:
#   1. base      — node:24-bookworm-slim + corepack pnpm
#   2. deps      — install ALL deps (dev included) so tsc + vite are
#                  available for the build step
#   3. builder   — `pnpm app:build` + `pnpm exec tsc` to compile both
#   4. runtime   — copy only built artefacts + production deps

# ─── 1. Base ───────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app

# ─── 2. Install deps (with dev for build) ──────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
# better-sqlite3 + onnxruntime build native bindings — they need build
# tools at install time. Keep them in this stage; we drop them in the
# runtime image.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile --prod=false

# ─── 3. Build SPA + transpile backend ─────────────────────────────────
FROM deps AS builder
COPY . .
# 3a. Frontend: Vite production bundle → app/dist
RUN pnpm app:build
# 3b. Backend: emit JS into dist-backend/ (no rootDir constraints; we
#     run via tsx-equivalent + .ts→.js extension stripping at import).
#     Easier path: ship the .ts files and run via tsx at runtime.
#     We'll go with tsx-at-runtime because the codebase relies on
#     extensionless imports that tsc rewrites awkwardly.

# ─── 4. Runtime ───────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production OPENCANVAS_DEMO=1 HOST=0.0.0.0

# Production deps only — slimmer image.
COPY package.json pnpm-lock.yaml ./
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && pnpm install --frozen-lockfile --prod \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y

# tsx lives in devDependencies — pull it into the runtime image so we
# can run the .ts entry point without a separate transpile step.
RUN pnpm add tsx@latest

# Built SPA + source files we actually run from.
COPY --from=builder /app/app/dist        ./app/dist
COPY --from=builder /app/src             ./src
COPY --from=builder /app/docs/openapi.yaml ./docs/openapi.yaml
COPY --from=builder /app/tsconfig.json   ./tsconfig.json

EXPOSE 3457
CMD ["pnpm", "tsx", "src/backend/server.ts"]
