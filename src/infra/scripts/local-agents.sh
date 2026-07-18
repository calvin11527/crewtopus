#!/usr/bin/env bash
###############################################################################
# Run AgentHub backend on the host (macOS Grok/Claude CLIs) while k8s serves
# frontend + infra. Grok CLI is macOS-native and cannot run inside Linux pods.
#
# Usage:
#   ./local-agents.sh start
#   ./local-agents.sh stop
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$(dirname "$INFRA_DIR")"
NAMESPACE="agent-hub"
HOST_BACKEND_PORT="${HOST_BACKEND_PORT:-3002}"
HOST_BACKEND="host.k3d.internal:${HOST_BACKEND_PORT}"
CLUSTER_BACKEND="agenthub-backend.agent-hub.svc.cluster.local:3000"
CONFIGMAP="frontend-nginx-config"
TEMPLATE="$INFRA_DIR/k8s/frontend-nginx-host-backend.conf"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
log() { echo -e "${GREEN}[AgentHub]${NC} $*"; }
warn() { echo -e "${YELLOW}[Warn]${NC} $*"; }

require_k8s() {
  if ! kubectl get ns "$NAMESPACE" &>/dev/null; then
    echo "Namespace $NAMESPACE not found. Run: npm run k8s:up"
    exit 1
  fi
}

apply_nginx_upstream() {
  local upstream="$1"
  local conf
  conf="$(sed "s|__BACKEND_UPSTREAM__|${upstream}|g" "$TEMPLATE")"
  kubectl create configmap "$CONFIGMAP" -n "$NAMESPACE" \
    --from-literal=default.conf="$conf" \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl rollout restart deployment/agenthub-frontend -n "$NAMESPACE"
  kubectl rollout status deployment/agenthub-frontend -n "$NAMESPACE" --timeout=90s
}

start_mode() {
  require_k8s

  if ! command -v grok &>/dev/null; then
    warn "grok not on PATH — install Grok CLI and run: grok login"
  elif ! grok --version &>/dev/null; then
    warn "grok found but --version failed — run: grok login"
  fi

  log "Scaling in-cluster backend to 0..."
  kubectl scale deployment/agenthub-backend -n "$NAMESPACE" --replicas=0

  log "Routing frontend API to host backend (${HOST_BACKEND})..."
  apply_nginx_upstream "$HOST_BACKEND"

  log "Start the host backend in another terminal:"
  echo ""
  echo "  cd $SRC_DIR"
  echo "  mkdir -p \"\$HOME/agenthub-work\""
  echo "  export AGENTHUB_WORK_DIR=\"\$HOME/agenthub-work\""
  echo "  export GROK_PERMISSION_MODE=bypassPermissions"
  echo "  export PORT=${HOST_BACKEND_PORT}"
  echo "  npm run dev:backend"
  echo ""
  log "UI: http://localhost:8080  |  API: http://localhost:${HOST_BACKEND_PORT} (host)"
}

stop_mode() {
  require_k8s
  log "Restoring in-cluster backend and nginx proxy..."
  kubectl scale deployment/agenthub-backend -n "$NAMESPACE" --replicas=1
  apply_nginx_upstream "$CLUSTER_BACKEND"
  kubectl rollout status deployment/agenthub-backend -n "$NAMESPACE" --timeout=120s
  log "Host-agent mode disabled (Grok in pods will fall back to mock)."
}

case "${1:-start}" in
  start) start_mode ;;
  stop) stop_mode ;;
  *) echo "Usage: $0 {start|stop}"; exit 1 ;;
esac