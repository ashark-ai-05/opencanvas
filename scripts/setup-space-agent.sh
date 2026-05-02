#!/usr/bin/env bash
# Sets up vendor/space-agent/ at a pinned commit and creates a default admin user.
# Idempotent: re-running is safe.

set -euo pipefail

PINNED_SHA="9c26f9f"            # space-agent main HEAD as of 2026-05-01 (per Spike 05)
REPO_URL="https://github.com/agent0ai/space-agent.git"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$PROJECT_ROOT/vendor"
SPACE_AGENT_DIR="$VENDOR_DIR/space-agent"

mkdir -p "$VENDOR_DIR"

if [ ! -d "$SPACE_AGENT_DIR/.git" ]; then
  echo "==> Cloning space-agent into $SPACE_AGENT_DIR"
  git clone "$REPO_URL" "$SPACE_AGENT_DIR"
fi

echo "==> Pinning space-agent to $PINNED_SHA"
cd "$SPACE_AGENT_DIR"
git fetch origin
git checkout "$PINNED_SHA"

if [ ! -d "$SPACE_AGENT_DIR/node_modules" ]; then
  echo "==> Installing space-agent dependencies (this can take ~30s)"
  npm install
else
  echo "==> space-agent node_modules already present (skipping npm install)"
fi

# Create a default admin user under CUSTOMWARE_PATH/L2 (where serve mode looks).
# Default to $PROJECT_ROOT/customware so the user lands in the same L2 tree
# that `pnpm dev` mounts via CUSTOMWARE_PATH. If we don't pass this through,
# the user lands in space-agent's bundled L2 and serve-time login 401s.
export CUSTOMWARE_PATH="${CUSTOMWARE_PATH:-$PROJECT_ROOT/customware}"
mkdir -p "$CUSTOMWARE_PATH/L2"
ADMIN_DIR="$CUSTOMWARE_PATH/L2/admin"

if [ -d "$ADMIN_DIR" ]; then
  echo "==> Admin user already exists at $ADMIN_DIR"
else
  echo "==> Creating default admin user (password: change-me-now)"
  echo "    Location: $ADMIN_DIR"
  node space user create admin \
    --password "change-me-now" \
    --full-name "Admin (llm-wiki dev)" \
    --groups _admin
fi

echo ""
echo "==> Setup complete."
echo "    Space-agent: $SPACE_AGENT_DIR"
echo "    Pinned to:   $PINNED_SHA"
echo "    Run:         pnpm dev"
