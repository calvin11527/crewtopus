# Crewtopus

## Multi-Agent AI Orchestration Desktop Platform

Crewtopus orchestrates multiple AI coding agents (Claude Code, Grok, Copilot, Antigravity, Ollama) through a unified workflow engine with privacy controls, audit logging, and proactive automation.

## Quick Start

### Prerequisites

- Node.js >= 20
- Docker Desktop (for Redis, Ollama, Prometheus, Grafana)
- At least one AI CLI tool installed (claude, grok, copilot, antigravity, or ollama)

### 1. Start Infrastructure

```bash
cd src
npm run infra:up
```

This starts Redis, Ollama, Prometheus, and Grafana via Docker Compose.

### 2. Install Dependencies

```bash
cd src
npm install
cd backend && npm install
cd ../frontend && npm install
```

### 3. Start Development

```bash
cd src
npm run dev
```

- Backend API: http://localhost:3000
- Frontend UI: http://localhost:5173
- Grafana: http://localhost:3001

### 4. Open the App

Navigate to http://localhost:5173 in your browser.

## Log Console

Crewtopus provides two console surfaces for observing agent output:

| Surface | Location | Data source |
|---------|----------|-------------|
| **Work-item console** | Board → work item detail | Live WebSocket stream (CLI stdout/stderr, pipeline steps) |
| **Server Logs page** | `/logs` in the sidebar | Persisted events from `GET /api/logs` |

### Work-item console (streaming)

Embedded on the Board when a work item is running or has recent activity.

- **Live stream** — CLI chunks and pipeline events append in real time (`aria-live="polite"`).
- **Partial lines** — In-progress stdout/stderr chunks show a `data-partial` indicator until a newline arrives.
- **Autoscroll** — Toggle with the *Scroll on/off* button; preference is saved in `localStorage`.
- **Inline filters** — Search message text and filter by severity (All / INFO / WARN / ERR).
- **Export** — Download visible lines as `.log` or JSON from the toolbar.
- **Line selection** — Click the timestamp gutter (or press **Enter** / **Space** on the gutter) to select a line for copy.

### Server Logs page (filtering & export)

Browse and export persisted log events from the backend API.

- **Filters** — Agent type, agent, severity, message search, and datetime range (debounced search).
- **Infinite scroll** — Scroll to the top of the console to load older pages.
- **Export** — Download the current filtered result as `.log` or `.json` (JSON includes active filter metadata).
- **Copy** — Select a line in the console, then use the panel *Copy* button.

### Keyboard & accessibility

Both consoles share the same accessible patterns:

| Control | Keyboard / ARIA |
|---------|-----------------|
| Log line list | `role="listbox"` with `aria-label="Console log lines"` |
| Select line | Focus gutter → **Enter** or **Space**; `aria-selected` reflects state |
| Severity filter (work-item toolbar) | `role="group"` buttons with `aria-pressed` |
| Autoscroll toggle | `aria-pressed` + `aria-label="Toggle autoscroll"` |
| Server log filters | `role="search"` with labeled fields (`Agent type`, `Severity`, `From`, `To`) |
| Copy feedback | `role="status"` live region on the Logs page |
| Loading / errors | `role="status"` for pagination; `role="alert"` for load failures |

Screen-reader-only labels (`sr-only`) are used where icons replace visible text (e.g. search fields).

### Running console-related tests

```bash
cd src
npm run test:backend -- --testPathPattern="log-events|logs-api"
npm run test:frontend -- ConsoleFilters StreamingConsole Logs log-export log-events websocket-client
```

## Architecture

```
Crewtopus
├── Backend (Node.js/Express + WebSocket)
│   ├── Agent Adapters (Claude, Grok, Copilot, Antigravity, Ollama)
│   ├── Supervisor Engine (central orchestration)
│   ├── Workflow Engine (deterministic execution)
│   ├── Privacy Guard (secret scanning)
│   ├── Approval Gate (human-in-the-loop)
│   ├── Audit Logger (immutable logging)
│   ├── Proactive Engine (file watchers, triggers)
│   └── Consensus Engine (multi-agent decisions)
├── Frontend (React + TypeScript + Vite)
│   ├── Dashboard
│   ├── Workspace Management
│   ├── Agent Registry
│   ├── Workflow Designer
│   ├── Privacy & Security
│   └── Audit Log Viewer
└── Infrastructure (Docker/k8s)
    ├── Redis
    ├── Ollama
    ├── Prometheus
    └── Grafana
```

## Project Structure

```
src/
├── package.json          # Root monorepo config
├── backend/              # Express + WebSocket backend
│   ├── src/
│   │   ├── index.ts      # Server entry point
│   │   ├── database.ts   # SQLite setup & migrations
│   │   ├── types.ts      # TypeScript interfaces
│   │   ├── routes/       # REST API endpoints
│   │   ├── modules/      # Core business logic
│   │   ├── adapters/     # Agent CLI adapters
│   │   └── websocket.ts  # Real-time streaming
│   └── package.json
├── frontend/             # React desktop UI
│   ├── src/
│   │   ├── main.tsx      # Entry point
│   │   ├── App.tsx       # App shell + routing
│   │   ├── App.css       # Design system
│   │   ├── pages/        # Page components
│   │   ├── components/   # Reusable components
│   │   ├── stores/       # Zustand state
│   │   └── api/          # API client
│   └── package.json
└── infra/                # Docker & k8s
    ├── docker-compose.yml
    ├── k8s/              # Kubernetes manifests
    └── k3d/              # k3d cluster config
```

## Modules

| Module | Description |
|--------|-------------|
| Workspace Management | Projects, repositories, configurations |
| Agent Registry | Dynamic agent registration and status |
| Capability Registry | Agent capability metadata for routing |
| Workflow Engine | Deterministic workflow execution |
| Supervisor Engine | Central orchestration (no agent bypass) |
| ContextScope Builder | Minimal context construction |
| Privacy Guard | Secret scanning & data leakage prevention |
| Approval Gate | Human approval for sensitive operations |
| Audit Logger | Immutable operation logging |
| Proactive Engine | Background automation triggers |
| Consensus Engine | Multi-agent decision combining |

## License

[PolyForm Noncommercial 1.0.0](../LICENSE) — **non-commercial use only.** See the repository root for the full license text.

For the public project overview, security policy, and environment template, see the [root README](../README.md), [SECURITY.md](../SECURITY.md), and [.env.example](../.env.example).
