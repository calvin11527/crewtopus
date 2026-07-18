# AgentHub Infrastructure

Local development infrastructure for AgentHub — includes Redis, Ollama, Prometheus, and Grafana.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Docker / k3d Cluster                      │
│                                                               │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐  │
│  │   Frontend   │────▶│   Backend    │────▶│    Ollama    │  │
│  │ nginx :8080  │     │  API :3000   │     │   :11434     │  │
│  └──────────────┘     └──────┬───────┘     └──────────────┘  │
│                              │                                │
│         ┌────────────────────┼────────────────────┐           │
│         ▼                    ▼                    ▼           │
│    ┌─────────┐        ┌────────────┐        ┌─────────┐      │
│    │  Redis  │        │ Prometheus │───────▶│ Grafana │      │
│    │  :6379  │        │   :9090    │        │  :3001  │      │
│    └─────────┘        └────────────┘        └─────────┘      │
└──────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Docker Desktop** for macOS (running)
- **Docker Compose** v2+ (bundled with Docker Desktop)

For Kubernetes deployment:
- **k3d** — `brew install k3d`
- **kubectl** — `brew install kubectl`

---

## Option 1: Docker Compose (Recommended)

Deploys frontend, backend, Redis, Ollama, Prometheus, and Grafana in one command.

### Start Full Stack

```bash
cd src/infra
./scripts/setup.sh compose
```

Or from the monorepo root:

```bash
npm run docker:up
```

### Build Images Only

```bash
./scripts/setup.sh build
# or: npm run docker:build
```

### Verify Services

```bash
# Check all containers are healthy
docker compose ps

# Test Redis
docker exec agenthub-redis redis-cli ping
# → PONG

# Test Ollama
curl http://localhost:11434/api/tags

# Test Prometheus
curl http://localhost:9090/-/healthy

# Test Grafana
curl http://localhost:3001/api/health
```

### Stop Services

```bash
./scripts/setup.sh compose-down
# or: npm run docker:down

# Full reset including volumes
docker compose down -v
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f redis
docker compose logs -f ollama
docker compose logs -f prometheus
docker compose logs -f grafana
```

---

## Option 2: k3d / Kubernetes

Production-like local Kubernetes deployment. Builds Docker images, imports them into k3d, and deploys all services.

### Automated Setup

```bash
cd src/infra
chmod +x scripts/setup.sh

# Full setup: build images + create cluster + deploy all
./scripts/setup.sh

# Deploy only (cluster must already exist)
./scripts/setup.sh deploy

# Tear down
./scripts/setup.sh destroy

# Check status
./scripts/setup.sh status
```

From monorepo root: `npm run k8s:up`, `npm run k8s:deploy`, `npm run k8s:down`, `npm run k8s:status`

### Manual Setup

```bash
# 1. Build images (from src/)
docker build -t agenthub-backend:latest -f backend/Dockerfile .
docker build -t agenthub-frontend:latest -f frontend/Dockerfile .

# 2. Create k3d cluster and import images
k3d cluster create --config k3d/cluster-config.yml
k3d image import agenthub-backend:latest agenthub-frontend:latest -c agenthub

# 3. Apply manifests
kubectl apply -f k8s/namespace.yml
kubectl apply -f k8s/redis-deployment.yml
kubectl apply -f k8s/ollama-deployment.yml
kubectl apply -f k8s/backend-deployment.yml
kubectl apply -f k8s/frontend-deployment.yml
kubectl apply -f k8s/prometheus-deployment.yml
kubectl create configmap grafana-dashboards -n agenthub \
  --from-file=agenthub.json=grafana/dashboards/agenthub.json \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f k8s/grafana-deployment.yml

# 4. Wait for pods
kubectl wait --for=condition=Ready pod --all -n agenthub --timeout=600s
```

### Port Forwarding (if NodePort isn't working)

```bash
kubectl port-forward svc/redis 6379:6379 -n agenthub &
kubectl port-forward svc/ollama 11434:11434 -n agenthub &
kubectl port-forward svc/prometheus 9090:9090 -n agenthub &
kubectl port-forward svc/grafana 3001:3001 -n agenthub &
```

---

## Accessing Services

| Service    | URL / Address               | Credentials   |
|------------|----------------------------|---------------|
| Frontend   | `http://localhost:8080`    | —             |
| Backend    | `http://localhost:3000`    | —             |
| Redis      | `redis://localhost:6379`   | —             |
| Ollama     | `http://localhost:11434`   | —             |
| Prometheus | `http://localhost:9090`    | —             |
| Grafana    | `http://localhost:3001`    | admin / admin |

### Grafana Dashboard

A pre-provisioned **AgentHub Overview** dashboard is available at:

```
http://localhost:3001/d/agenthub-overview
```

Panels include:
- **Active Workflows** — gauge of currently running workflows
- **Agent Invocation Count** — rate of agent calls by name
- **Workflow Execution Status** — success/failure/timeout breakdown
- **Token Usage Over Time** — prompt vs completion tokens
- **Cost Tracking** — per-model USD cost over time
- **Privacy Guard Block Rate** — percentage of blocked requests

### Pull Recommended Local Models

AgentHub ships a curated catalog for coding and privacy-sensitive work. Western/open providers only (Meta, Mistral, Microsoft, Google, IBM, BigCode). Default: **gemma4:26b-mlx** (Gemma 4 MoE, MLX-optimized for Apple Silicon).

| Tier | RAM | Models |
|------|-----|--------|
| default | ~20GB+ | gemma4:26b-mlx |
| lightweight | ~4–8GB | llama3.2:3b, gemma4:e4b, phi3:3.8b |
| balanced | ~8–12GB | llama3.1:8b, gemma4:12b-mlx, mistral:7b |
| quality | ~20GB+ | gemma4:26b-mlx, gemma4:31b-mlx, codestral:22b |
| pro48 | ~48GB | gemma4:26b-mlx, gemma4:31b-mlx, codestral:22b, devstral:24b |

```bash
# From repo root — pull the AgentHub default model
cd src && npm run infra:pull-models

# 48GB MacBook Pro stack (no China-based models)
cd src/infra && ./scripts/pull-recommended-models.sh pro48

# Single model via Ollama CLI
ollama pull gemma4:26b-mlx
```

Browse recommendations in the UI under **Agents → Ollama → Model**, or via `GET /api/agents/local-models`.

---

## File Structure

```
infra/
├── docker-compose.yml          # Full stack: app + infra services
├── README.md                   # This file
│
├── prometheus/
│   └── prometheus.yml          # Prometheus scrape configuration
│
├── grafana/
│   ├── dashboards/
│   │   └── agenthub.json       # Pre-built Grafana dashboard
│   └── provisioning/
│       ├── dashboards/
│       │   └── dashboard.yml   # Dashboard auto-provisioning
│       └── datasources/
│           └── datasource.yml  # Prometheus datasource config
│
├── redis/
│   └── redis.conf              # Redis configuration
│
├── k3d/
│   └── cluster-config.yml      # k3d cluster configuration
│
├── k8s/
│   ├── namespace.yml           # agenthub namespace
│   ├── backend-deployment.yml  # Backend API + PVC + service
│   ├── frontend-deployment.yml # Frontend nginx + service
│   ├── redis-deployment.yml    # Redis deployment + service
│   ├── ollama-deployment.yml   # Ollama deployment + service
│   ├── prometheus-deployment.yml # Prometheus + configmap + service
│   └── grafana-deployment.yml  # Grafana + configmaps + service
│
└── scripts/
    └── setup.sh                # Automated k3d setup script
```

---

## Troubleshooting

### Docker Compose Issues

**Containers not starting:**
```bash
# Check logs for errors
docker compose logs <service-name>

# Restart a specific service
docker compose restart <service-name>

# Full reset
docker compose down -v && docker compose up -d
```

**Port conflicts:**
If a port is already in use, either stop the conflicting service or change the port mapping in `docker-compose.yml`:
```bash
# Find what's using a port
lsof -i :6379
lsof -i :9090
lsof -i :3001
lsof -i :11434
```

**Prometheus not scraping AgentHub backend:**
- Docker Compose scrapes `agenthub-backend:3000` on the internal network
- Kubernetes scrapes `agenthub-backend.agenthub.svc.cluster.local:3000`
- Verify with `curl http://localhost:3000/metrics`

### Kubernetes Issues

**Pods stuck in Pending:**
```bash
kubectl describe pod <pod-name> -n agenthub
# Check Events section for scheduling or volume issues
```

**Ollama OOMKilled:**
Increase memory limits in `k8s/ollama-deployment.yml`:
```yaml
resources:
  limits:
    memory: 8Gi  # Increase for larger models
```

**PVC not binding:**
```bash
kubectl get pvc -n agenthub
# k3d uses local-path provisioner by default, PVCs should bind automatically
```

**Cluster won't start:**
```bash
# Ensure Docker Desktop is running and has enough resources
# Recommended: 4+ CPU cores, 8+ GB RAM allocated to Docker

# Delete and recreate
k3d cluster delete agenthub
./scripts/setup.sh
```

### Redis Issues

**Connection refused:**
```bash
# Verify Redis is healthy
docker exec agenthub-redis redis-cli ping

# Check config is loaded
docker exec agenthub-redis redis-cli config get maxmemory
```

**Memory issues:**
Redis is configured with `maxmemory 256mb` and `allkeys-lru` eviction. Adjust in `redis/redis.conf` if needed.

---

## Configuration Reference

### Environment Variables (Grafana)

| Variable                      | Default | Description                |
|-------------------------------|---------|----------------------------|
| `GF_SECURITY_ADMIN_USER`     | admin   | Grafana admin username     |
| `GF_SECURITY_ADMIN_PASSWORD` | admin   | Grafana admin password     |
| `GF_USERS_ALLOW_SIGN_UP`    | false   | Disable public sign-up     |

### Redis Configuration Highlights

| Setting            | Value        | Description                    |
|--------------------|-------------|--------------------------------|
| `maxmemory`       | 256mb       | Maximum memory usage           |
| `maxmemory-policy`| allkeys-lru | Evict least recently used keys |
| `appendonly`      | yes         | Enable AOF persistence         |
| `save`            | 900 1       | RDB snapshot every 15min       |

### Prometheus Scrape Targets

| Job Name           | Target                        | Interval |
|--------------------|-------------------------------|----------|
| prometheus         | localhost:9090                | 15s      |
| agenthub-backend   | host.docker.internal:3000    | 10s      |
| node-exporter      | host.docker.internal:9100    | 30s      |
