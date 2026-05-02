#!/usr/bin/env bash
# Boots space-agent in dev mode with our customware/ directory mounted.
# Use --smoke to run a one-shot HTTP probe and exit cleanly (for tests/CI).

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPACE_AGENT_DIR="$PROJECT_ROOT/vendor/space-agent"
CUSTOMWARE="$PROJECT_ROOT/customware"

if [ ! -d "$SPACE_AGENT_DIR" ]; then
  echo "Error: vendor/space-agent not found. Run 'pnpm setup' first." >&2
  exit 1
fi

if [ ! -d "$CUSTOMWARE" ]; then
  echo "Error: customware/ directory not found in project root." >&2
  exit 1
fi

# Default to a non-3000 port so it does not collide with common dev servers.
PORT="${PORT:-3456}"
HOST="${HOST:-127.0.0.1}"

cd "$SPACE_AGENT_DIR"

if [ "${1:-}" = "--smoke" ]; then
  echo "==> Booting space-agent (smoke mode) on $HOST:$PORT"
  CUSTOMWARE_PATH="$CUSTOMWARE" PORT="$PORT" HOST="$HOST" \
    node space serve &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

  # Wait up to 10 seconds for the server to come up.
  for i in $(seq 1 10); do
    if curl -sf "http://$HOST:$PORT/" -o /dev/null -w "%{http_code}\n" 2>&1 | grep -qE "^(2|3)"; then
      echo "==> Smoke check passed."
      exit 0
    fi
    sleep 1
  done

  echo "==> Smoke check FAILED after 10 seconds." >&2
  exit 1
fi

echo "==> Booting space-agent on http://$HOST:$PORT"
echo "    Customware: $CUSTOMWARE"
echo "    Press Ctrl-C to stop."
echo ""

exec env CUSTOMWARE_PATH="$CUSTOMWARE" PORT="$PORT" HOST="$HOST" \
  node space serve
