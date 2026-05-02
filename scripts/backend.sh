#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

PORT="${LLM_WIKI_BACKEND_PORT:-3457}"

if [ "${1:-}" = "--smoke" ]; then
  echo "==> Booting backend on :$PORT (smoke)"
  pnpm tsx src/backend/server.ts &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
  for i in $(seq 1 10); do
    if curl -sf "http://127.0.0.1:$PORT/v1/health" -o /dev/null; then
      echo "==> /v1/health responded — smoke OK"
      exit 0
    fi
    sleep 1
  done
  echo "==> Backend did not respond within 10s" >&2
  exit 1
fi

echo "==> Booting backend on http://127.0.0.1:$PORT"
exec pnpm tsx src/backend/server.ts
