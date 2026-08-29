#!/usr/bin/env bash
# Start Crewtopus backend (API) + frontend (UI).
# Usage: ./start.sh
# Env: CREWTOPUS_UI, CREWTOPUS_API, OPEN_BROWSER=1
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI="${CREWTOPUS_UI:-http://localhost:5173}"
API="${CREWTOPUS_API:-http://localhost:3000}"
API_HEALTH="${API%/}/api/health"
OPEN_BROWSER="${OPEN_BROWSER:-0}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js ≥ 20 is required." >&2
  exit 1
fi

cd "$ROOT/src"

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies…"
  npm run setup
fi

if [[ "$OPEN_BROWSER" == "1" ]]; then
  (
    for _ in $(seq 1 90); do
      if curl -sf "$API_HEALTH" >/dev/null 2>&1; then
        if command -v open >/dev/null 2>&1; then
          open "$UI" 2>/dev/null || true
        fi
        exit 0
      fi
      sleep 0.5
    done
  ) &
fi

echo ""
echo "Starting Crewtopus…"
echo "  UI:  $UI"
echo "  API: $API"
echo "  Press Ctrl+C to stop both services."
echo ""

exec npm run dev
