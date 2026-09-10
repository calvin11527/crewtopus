# Experimental infra (quarantined)

These paths are **not** the Crewtopus product:

| Path | What it claimed | Why it is experimental |
|---|---|---|
| `docker-compose.yml` | Redis + Ollama + Prometheus + Grafana | Redis is optional LPUSH with no consumer; SQLite cannot HA |
| `k8s/` + `hpa.yml` | Scale backend/frontend/redis | HPA on a SQLite process is unsafe |
| `grafana/` + `prometheus/` | Production dashboards | Metrics now emit `crewtopus_*` and `agenthub_*`; scrape only if you opted in |

Supported: `./demo.sh` and `npm run dev`.
