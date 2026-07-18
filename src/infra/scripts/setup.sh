#!/usr/bin/env bash
###############################################################################
# AgentHub – Infrastructure Setup Script
#
# Usage:
#   ./setup.sh              # k8s: create cluster + build images + deploy all
#   ./setup.sh deploy       # k8s: deploy only (cluster must exist)
#   ./setup.sh compose      # docker: build images + start full stack
#   ./setup.sh compose-down # docker: stop stack
#   ./setup.sh build        # build backend + frontend Docker images
#   ./setup.sh destroy      # delete k3d cluster
#   ./setup.sh status       # show k8s status
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$(dirname "$INFRA_DIR")"
CLUSTER_NAME="agenthub"
NAMESPACE="agent-hub"
K3D_CONFIG="$INFRA_DIR/k3d/cluster-config.yml"
K8S_DIR="$INFRA_DIR/k8s"
COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"
DASHBOARD_FILE="$INFRA_DIR/grafana/dashboards/agenthub.json"
BACKEND_IMAGE="agenthub-backend:latest"
FRONTEND_IMAGE="agenthub-frontend:latest"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[AgentHub]${NC} $*"; }
warn()  { echo -e "${YELLOW}[Warn]${NC} $*"; }
error() { echo -e "${RED}[Error]${NC} $*" >&2; }

check_docker() {
  if ! command -v docker &>/dev/null; then
    error "Docker is required but not installed."
    exit 1
  fi
  if ! docker info &>/dev/null; then
    error "Docker is not running. Start Docker Desktop first."
    exit 1
  fi
}

check_k8s_deps() {
  local missing=()
  for cmd in docker kubectl k3d; do
    if ! command -v "$cmd" &>/dev/null; then
      missing+=("$cmd")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    error "Missing required tools: ${missing[*]}"
    error "Install with: brew install k3d kubectl"
    exit 1
  fi
  check_docker
}

cluster_exists() {
  k3d cluster list 2>/dev/null | grep -q "^${CLUSTER_NAME}"
}

build_images() {
  log "Building Docker images..."
  docker build -t "$BACKEND_IMAGE" -f "$SRC_DIR/backend/Dockerfile" "$SRC_DIR"
  docker build -t "$FRONTEND_IMAGE" -f "$SRC_DIR/frontend/Dockerfile" "$SRC_DIR"
  log "Images built: $BACKEND_IMAGE, $FRONTEND_IMAGE"
}

import_images() {
  log "Importing images into k3d cluster '${CLUSTER_NAME}'..."
  k3d image import "$BACKEND_IMAGE" "$FRONTEND_IMAGE" -c "$CLUSTER_NAME"
}

create_cluster() {
  if cluster_exists; then
    warn "Cluster '${CLUSTER_NAME}' already exists, skipping creation"
    return
  fi
  log "Creating k3d cluster '${CLUSTER_NAME}'..."
  k3d cluster create --config "$K3D_CONFIG"
  log "Cluster created successfully"
}

deploy_manifests() {
  log "Applying Kubernetes manifests..."

  if kubectl get namespace agenthub &>/dev/null; then
    warn "Removing legacy namespace 'agenthub'..."
    kubectl delete namespace agenthub --timeout=120s || true
  fi

  log "Installing metrics-server (required for HPA)..."
  kubectl apply -f "$K8S_DIR/metrics-server.yml"

  kubectl apply -f "$K8S_DIR/namespace.yml"

  for manifest in \
    redis-deployment.yml \
    ollama-deployment.yml \
    backend-deployment.yml \
    frontend-deployment.yml \
    prometheus-deployment.yml
  do
    kubectl apply -f "$K8S_DIR/$manifest"
  done

  if [ ! -f "$DASHBOARD_FILE" ]; then
    error "Dashboard file not found: $DASHBOARD_FILE"
    exit 1
  fi

  log "Creating Grafana dashboard ConfigMap..."
  kubectl create configmap grafana-dashboards \
    --namespace="$NAMESPACE" \
    --from-file=agenthub.json="$DASHBOARD_FILE" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl apply -f "$K8S_DIR/grafana-deployment.yml"
  kubectl apply -f "$K8S_DIR/hpa.yml"

  log "Waiting for pods to become ready (timeout: 600s)..."
  kubectl wait --for=condition=Ready pod --all -n "$NAMESPACE" --timeout=600s

  log "Deployment status:"
  kubectl get pods -n "$NAMESPACE"
  kubectl get svc -n "$NAMESPACE"
  kubectl get hpa -n "$NAMESPACE"
}

destroy_cluster() {
  if ! cluster_exists; then
    warn "Cluster '${CLUSTER_NAME}' does not exist"
    return
  fi
  log "Destroying k3d cluster '${CLUSTER_NAME}'..."
  k3d cluster delete "$CLUSTER_NAME"
  log "Cluster destroyed"
}

compose_up() {
  check_docker
  log "Starting Docker Compose stack..."
  docker compose -f "$COMPOSE_FILE" up -d --build
  log "Waiting for services to become healthy..."
  sleep 5
  docker compose -f "$COMPOSE_FILE" ps
  print_compose_access_info
}

compose_down() {
  check_docker
  log "Stopping Docker Compose stack..."
  docker compose -f "$COMPOSE_FILE" down
}

print_compose_access_info() {
  echo ""
  log "AgentHub Docker Compose stack is ready!"
  echo ""
  echo "  Service            URL"
  echo "  ─────────────────────────────────────────────"
  echo "  Frontend (UI)      http://localhost:8080"
  echo "  Backend API        http://localhost:3000/api/health"
  echo "  WebSocket          ws://localhost:3000/ws"
  echo "  Redis              redis://localhost:6379"
  echo "  Ollama             http://localhost:11434"
  echo "  Prometheus         http://localhost:9090"
  echo "  Grafana            http://localhost:3001  (admin / admin)"
  echo "  Dashboard          http://localhost:3001/d/agenthub-overview"
  echo ""
}

print_k8s_access_info() {
  echo ""
  log "AgentHub Kubernetes stack is ready!"
  echo ""
  echo "  Service            URL"
  echo "  ─────────────────────────────────────────────"
  echo "  Frontend (UI)      http://localhost:8080"
  echo "  Backend API        http://localhost:3000/api/health"
  echo "  WebSocket          ws://localhost:3000/ws"
  echo "  Redis              redis://localhost:6379"
  echo "  Ollama             http://localhost:11434"
  echo "  Prometheus         http://localhost:9090"
  echo "  Grafana            http://localhost:3001  (admin / admin)"
  echo "  Dashboard          http://localhost:3001/d/agenthub-overview"
  echo ""
}

usage() {
  echo "Usage: $0 [command]"
  echo ""
  echo "Kubernetes (k3d):"
  echo "  (none)         Create cluster, build images, deploy everything"
  echo "  deploy         Deploy manifests only (cluster must exist)"
  echo "  destroy        Delete the k3d cluster"
  echo "  status         Show cluster and pod status"
  echo ""
  echo "Docker Compose:"
  echo "  compose        Build images and start full stack"
  echo "  compose-down   Stop Docker Compose stack"
  echo ""
  echo "Shared:"
  echo "  build          Build backend + frontend Docker images"
}

show_status() {
  check_k8s_deps
  if ! cluster_exists; then
    warn "Cluster '${CLUSTER_NAME}' does not exist"
    exit 1
  fi
  kubectl get nodes
  kubectl get pods,svc,hpa -n "$NAMESPACE"
}

main() {
  case "${1:-}" in
    -h|--help|help)
      usage
      return
      ;;
  esac

  case "${1:-}" in
    ""|setup|full)
      check_k8s_deps
      build_images
      create_cluster
      import_images
      deploy_manifests
      print_k8s_access_info
      ;;
    deploy)
      check_k8s_deps
      if ! cluster_exists; then
        error "Cluster '${CLUSTER_NAME}' does not exist. Run './setup.sh' first."
        exit 1
      fi
      build_images
      import_images
      deploy_manifests
      print_k8s_access_info
      ;;
    destroy)
      check_k8s_deps
      destroy_cluster
      ;;
    status)
      show_status
      ;;
    build)
      check_docker
      build_images
      ;;
    compose)
      compose_up
      ;;
    compose-down)
      compose_down
      ;;
    *)
      error "Unknown command: $1"
      usage
      exit 1
      ;;
  esac
}

main "$@"