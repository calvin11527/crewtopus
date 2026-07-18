# Getting Started

## Prerequisites

- **Node.js ≥ 20**
- **npm**
- **Docker Desktop** (optional: Redis, Ollama, Prometheus, Grafana)
- At least one agent CLI (Grok, Copilot, Claude Code, Ollama, …)

## Install & run

```bash
git clone https://github.com/calvin11527/crewtopus.git
cd crewtopus

# Optional infrastructure
cd src
npm run infra:up

# Dependencies
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..

# Optional config
cp ../.env.example .env

# Dev servers
npm run dev
```

| Service | URL |
|---------|-----|
| UI | http://localhost:5173 |
| API | http://localhost:3000 |
| Grafana (if infra) | http://localhost:3001 |

## First five minutes

1. Open **Agents** — hire or configure an agent; set **adapter** (e.g. Grok) and **model**.
2. Open **Workspaces** — create a workspace and link a local project folder.
3. Open **Board** — create a sprint and **staff** BA, PM, and developer roles.
4. Add a **story** and run **Full lifecycle**.
5. Watch **Live Activity** / the work-item console for CLI output.

## Over quota?

If a provider blocks runs (budget / token limit):

1. Go to **Agent Registry**
2. Open **Adapter / model** on the staffed agent
3. Switch provider (e.g. Copilot → Grok or Ollama)
4. Confirm and save — sprint staffing stays on the same agent id

## Next

- [Sprint Lifecycle](Sprint-Lifecycle)
- [Agents & Adapters](Agents-and-Adapters)
- [Configuration](Configuration)
