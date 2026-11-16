# Architecture

## High level

```
Frontend (React + Vite)
        │  REST + WebSocket
        ▼
Backend (Express + SQLite)
    ├── Loop worker (single job runtime)
    │     ├── work_item_pipeline / story BA·PM / workflow_execution / supervisor_task
    │     └── runAgentLoop → eval gates → loop-retry / approval-resume
    ├── Outbound harness (context → privacy → approval → adapter → audit)
    ├── Agent adapters (CLI: Grok, Copilot, Claude, Ollama, …)
    ├── Full lifecycle (BA / PM / developer pipeline)
    └── Workspaces / work items / sprints
```

**One runtime:** the loop worker is the executor. Workflow templates and the supervisor enqueue jobs; they do not run a second in-process agent path for board work.

## Agent run path

```
Board / full lifecycle
  → SQLite loop_job queue (loop-worker)
    → implement → test → review (× N, default 1)
      → executeOutboundPipeline
      → eval harness (verdict / tests / git_diff / step_output_match)
      → dual gates: reviewer · tester PASS/FAIL · harness evals
```

Unsupported loop `until` / `verdictParser` / eval types **fail fast** at run start (honest loop contract).

## Major pieces

| Area | Role |
|------|------|
| **Workspaces** | Local project roots; optional `allowedWriteRoots` for outbound cwd checks |
| **Board** | Epics, stories, tasks; live agent activity; gate lights on pipeline results |
| **Agent registry** | Hire agents, adapter type, model, usage limits |
| **Sprint team** | Map roles (BA, PM, developer, …) to agents |
| **Full lifecycle** | BA requirements → PM task split → developer runs |
| **Loop / eval harness** | Iteration control, tester gate, allowlisted test argv, artifacts under `loop-artifacts/` |
| **Privacy guard** | Best-effort secret scanning on outbound context |
| **Audit / logs** | Run history and server log console |

## Runtime data (local, not published)

| Path | Purpose |
|------|---------|
| `src/backend/data/` | SQLite database |
| `.agenthub-work/` / `.crewtopus-work/` | Work-item artifacts, CLI stream logs, `loop-artifacts/` |
| `AGENTHUB_WORK_DIR` / `CREWTOPUS_WORK_DIR` | Override root for agent work output |

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
