#!/usr/bin/env bash
# Local one-shot: install → dev servers → open UI → optional mock demo.
# Usage: ./quickstart.sh [--no-demo] [--no-open]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI="${CREWTOPUS_UI:-http://localhost:5173}"
API="${CREWTOPUS_API:-http://localhost:3000/api}"
RUN_DEMO=1
OPEN_BROWSER=1

for arg in "$@"; do
  case "$arg" in
    --no-demo) RUN_DEMO=0 ;;
    --no-open) OPEN_BROWSER=0 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js ≥ 20 is required." >&2
  exit 1
fi

cd "$ROOT/src"
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies…"
  npm run setup
fi

# Kill stale listeners if any (best-effort)
if command -v lsof >/dev/null 2>&1; then
  for p in 3000 5173; do
    pid=$(lsof -ti :"$p" 2>/dev/null || true)
    if [[ -n "${pid:-}" ]]; then
      echo "Port $p in use (pid $pid) — leaving it; will reuse if healthy."
    fi
  done
fi

if ! curl -sf "$API/health" >/dev/null 2>&1; then
  echo "Starting Crewtopus (API + UI)…"
  npm run dev &
  DEV_PID=$!
  trap 'kill $DEV_PID 2>/dev/null || true' EXIT
  echo "Waiting for API…"
  for i in $(seq 1 60); do
    if curl -sf "$API/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
    if [[ "$i" -eq 60 ]]; then
      echo "API did not become healthy." >&2
      exit 1
    fi
  done
else
  echo "API already healthy at $API"
  DEV_PID=""
  trap - EXIT
fi

if [[ "$OPEN_BROWSER" -eq 1 ]]; then
  echo "Opening $UI …"
  if command -v open >/dev/null 2>&1; then
    open "$UI" 2>/dev/null || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$UI" 2>/dev/null || true
  fi
fi

if [[ "$RUN_DEMO" -eq 1 ]]; then
  echo "Running mock multi-agent demo…"
  export CREWTOPUS_API="$API"
  export CREWTOPUS_UI="$UI"
  npm run demo || true
  if [[ "$OPEN_BROWSER" -eq 1 ]]; then
    if command -v open >/dev/null 2>&1; then
      open "$UI/board" 2>/dev/null || true
    fi
  fi
fi

echo ""
echo "✓ Crewtopus ready"
echo "  UI:    $UI"
echo "  Board: $UI/board"
echo "  API:   ${API%/api}"
echo ""
if [[ -n "${DEV_PID:-}" ]]; then
  echo "Dev servers running in background (pid $DEV_PID). Stop with: kill $DEV_PID"
  # Keep script alive so trap doesn't kill servers immediately when we disable trap
  trap - EXIT
  wait $DEV_PID 2>/dev/null || true
fi
