# Crewtopus local infra

The supported stack is **API + UI on your machine** (SQLite, no Redis/k8s required).

```bash
# from repo root
./demo.sh
```

That uses `docker-compose.demo.yml` (backend + frontend, mock agents).

Local development without Docker:

```bash
cd src && npm install && npm run dev
```

## Experimental (not product-complete)

`docker-compose.yml`, `k8s/`, `grafana/`, `prometheus/`, and `k3d/` are a leftover full-stack sketch. They assume multi-replica services, Redis as a queue, and MLX Ollama images that do not match the localhost SQLite worker.

To run them anyway:

```bash
CREWTOPUS_EXPERIMENTAL_INFRA=1 ./scripts/setup.sh compose
```

Do not expose that stack on a network without `CREWTOPUS_API_TOKEN`.
