#!/usr/bin/env bash
# Crewtopus one-command demo: build + start lean Docker stack (API + UI, mock agents).
# Usage:
#   ./demo.sh           # build & start
#   ./demo.sh down      # stop & remove containers
#   ./demo.sh logs      # follow logs
#   ./demo.sh run       # after up: run mock pipeline against the stack
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT/src/infra/docker-compose.demo.yml"
# Default: hit API through nginx so host :3000 can stay free for local npm run dev
UI="${CREWTOPUS_UI:-http://localhost:8080}"
API="${CREWTOPUS_API:-http://localhost:8080/api}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop, then re-run ./demo.sh" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, then re-run ./demo.sh" >&2
  exit 1
fi

cmd="${1:-up}"

case "$cmd" in
  down|stop)
    docker compose -f "$COMPOSE_FILE" down
    echo "Stopped. (Volume crewtopus-demo-data kept; remove with: docker volume rm src_crewtopus-demo-data 2>/dev/null || true)"
    ;;
  logs)
    docker compose -f "$COMPOSE_FILE" logs -f
    ;;
  run|pipeline)
    export CREWTOPUS_API="$API"
    export CREWTOPUS_UI="$UI"
    if [[ ! -d "$ROOT/src/node_modules" ]]; then
      echo "Installing JS deps for demo script (one-time)…"
      (cd "$ROOT/src" && npm install --ignore-scripts >/dev/null)
    fi
    (cd "$ROOT/src" && node scripts/run-mock-demo.mjs)
    ;;
  up|start|"")
    echo "🐙 Building & starting Crewtopus demo stack…"
    docker compose -f "$COMPOSE_FILE" up -d --build
    echo ""
    echo "Waiting for API health…"
    for i in $(seq 1 60); do
      if curl -sf "$API/health" >/dev/null 2>&1; then
        break
      fi
      sleep 1
      if [[ "$i" -eq 60 ]]; then
        echo "API did not become healthy in time. Try: ./demo.sh logs" >&2
        exit 1
      fi
    done
    echo ""
    echo "✓ Crewtopus is up"
    echo "  UI:  $UI"
    echo "  API: ${API%/api}"
    echo ""
    echo "Open the board:  $UI/board"
    echo "Run mock crew:   ./demo.sh run"
    echo "Stop:            ./demo.sh down"
    echo ""
    # Auto-run mock pipeline once so first-time users see a finished story
    if [[ "${CREWTOPUS_DEMO_SKIP_PIPELINE:-}" != "1" ]]; then
      echo "Running mock pipeline (no paid CLIs)…"
      export CREWTOPUS_API="$API"
      export CREWTOPUS_UI="$UI"
      if command -v node >/dev/null 2>&1; then
        if [[ ! -f "$ROOT/src/scripts/run-mock-demo.mjs" ]]; then
          echo "Missing demo script" >&2
          exit 1
        fi
        # Script only needs Node fetch — no node_modules required for this file
        (cd "$ROOT/src" && node scripts/run-mock-demo.mjs) || true
      else
        echo "Node not found on host — skip auto pipeline. Use UI: Board → Multi-agent demo"
      fi
    fi
    ;;
  *)
    echo "Usage: ./demo.sh [up|down|logs|run]" >&2
    exit 1
    ;;
esac
