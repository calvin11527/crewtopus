# Configuration

Copy the template and adjust:

```bash
cp .env.example src/.env   # or export vars in your shell
```

## Core

| Variable | Default / notes |
|----------|-----------------|
| `PORT` | `3000` |
| `AGENTHUB_DB_PATH` | SQLite path (default under `src/backend/data/`) |
| `AGENTHUB_WORK_DIR` | Root for agent artifacts |
| `AGENTHUB_REDIS_URL` / `REDIS_URL` | Optional job queue |

> Env vars still use the `AGENTHUB_*` prefix for compatibility.

## Adapters

| Variable | Purpose |
|----------|---------|
| `GROK_CLI_PATH`, `GROK_TIMEOUT_MS`, `GROK_DEFAULT_MODEL` | Grok CLI |
| `COPILOT_TIMEOUT_MS`, `COPILOT_*` | Copilot CLI |
| `OLLAMA_HOST`, `OLLAMA_MODEL` | Local Ollama |
| `AGENTHUB_*_MONTHLY_TOKEN_QUOTA` | Soft/hard budget signals |

See [`.env.example`](https://github.com/calvin11527/crewtopus/blob/main/.env.example) for the full list.

## Frontend

| Variable | Purpose |
|----------|---------|
| `VITE_BACKEND_PORT` | Dev proxy target port |
| `VITE_WS_URL` | Override WebSocket URL |

## Infrastructure

```bash
cd src
npm run infra:up      # docker compose
npm run infra:down
```

Details: [src/infra/README.md](https://github.com/calvin11527/crewtopus/blob/main/src/infra/README.md)
