# Getting Started

## Prerequisites

- **Node.js ≥ 20**
- **npm**
- **Docker Desktop** (optional: Redis, Ollama, Prometheus, Grafana)
- For real agents: Grok, Copilot, Claude Code, Ollama, etc.  
  **Not required** for the mock demo path below.

## Fastest path (mock demo, ~60s)

```bash
git clone https://github.com/calvin11527/crewtopus.git
cd crewtopus/src
npm run setup
npm run dev
```

Second terminal:

```bash
cd crewtopus/src
npm run demo
```

Open **http://localhost:5173/board**, open the new story, watch the console.

Or in the UI: **Scrum Board** → **Multi-agent demo** (mock implement → test → review).

## Install & run (full)

```bash
git clone https://github.com/calvin11527/crewtopus.git
cd crewtopus/src

# Optional infrastructure
npm run infra:up

# Dependencies (workspaces)
npm run setup

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

## First five minutes (real agents)

1. Open **Agents** — configure adapter (Grok, Copilot, …) and model.
2. Open **Workspaces** — create a workspace and link a local project folder.
3. Open **Board** — create a sprint and **staff** BA, PM, and developer roles.
4. Add a **story** and run **Full lifecycle**.
5. Watch **Live Activity** / the work-item console for CLI output.

## Over quota?

If a provider blocks runs (budget / token limit):

1. Open **Agents** for that role.
2. Change **adapter** (e.g. Copilot → Grok) — same staffed role keeps working.
3. Re-run the story or pipeline step.

## Next

- [Agents & Adapters](Agents-and-Adapters)
- [Sprint Lifecycle](Sprint-Lifecycle)
- [Troubleshooting](Troubleshooting)
- [Roadmap](https://github.com/calvin11527/crewtopus/blob/main/docs/ROADMAP.md)
