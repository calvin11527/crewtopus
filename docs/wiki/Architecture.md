# Architecture

## High level

```
Frontend (React + Vite)
        │  REST + WebSocket
        ▼
Backend (Express + SQLite)
        ├── Agent adapters (CLI: Grok, Copilot, Claude, Ollama, …)
        ├── Full lifecycle (BA / PM / pipeline)
        ├── Privacy guard + audit log
        ├── Job queue (+ optional Redis)
        └── Workspaces / work items / sprints
```

## Major pieces

| Area | Role |
|------|------|
| **Workspaces** | Local project roots agents may read/write under |
| **Board** | Epics, stories, tasks; live agent activity |
| **Agent registry** | Hire agents, adapter type, model, usage limits |
| **Sprint team** | Map roles (BA, PM, developer, …) to agents |
| **Full lifecycle** | BA requirements → PM task split → developer runs |
| **Privacy guard** | Best-effort secret scanning on outbound context |
| **Audit / logs** | Run history and server log console |

## Runtime data (local, not published)

| Path | Purpose |
|------|---------|
| `src/backend/data/` | SQLite database |
| `.agenthub-work/` | Work-item artifacts, CLI stream logs |
| `AGENTHUB_WORK_DIR` | Override root for agent work output |

These are **gitignored**. Do not commit them.

## Repo layout

```
crewtopus/
├── docs/           # Specs + brand assets
├── src/
│   ├── backend/
│   ├── frontend/
│   └── infra/      # Docker / k8s
├── README.md
├── SECURITY.md
└── .env.example
```
