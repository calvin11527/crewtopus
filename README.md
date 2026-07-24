<p align="center">
  <img src="docs/assets/crewtopus-logo.png" alt="Crewtopus logo" width="160" height="160" />
</p>

<h1 align="center">Crewtopus</h1>

<p align="center">
  <strong>Many AI arms. One sprint crew.</strong><br/>
  Local multi-agent orchestration — staff BA, PM, and developers on a Kanban board<br/>
  and run a full delivery lifecycle (not just another chat window).
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js" /></a>
  <a href="https://github.com/calvin11527/crewtopus/releases"><img src="https://img.shields.io/github/v/release/calvin11527/crewtopus?include_prereleases" alt="Release" /></a>
  <a href="https://github.com/calvin11527/crewtopus/issues"><img src="https://img.shields.io/github/issues/calvin11527/crewtopus" alt="Issues" /></a>
</p>

<p align="center">
  <img src="docs/assets/crewtopus-demo.gif" alt="Crewtopus demo — dashboard, agent registry, scrum board, and work-item agent console" width="840" />
</p>

<p align="center"><em>Dashboard → agents → sprint board → work-item console</em></p>

> **Security:** Agents get broad local filesystem/tool access. Use only on machines and repos you trust. Do **not** expose the API to the public internet without auth. See [SECURITY.md](./SECURITY.md).

---

## Problem

Coding agents are strong **alone**. Delivery still falls apart because:

- Work lives in **chat history**, not on a board  
- There is no **BA → PM → dev → review** handoff  
- When one provider is over quota, you restart the whole thread  

**Crewtopus** turns agents into a **sprint crew**: roles, board state, pipeline, audit, adapter switch.

> One agent is a tool. A crew is a process.

---

## Try it in ~60 seconds (no API keys)

**Requirements:** Node.js ≥ 20, npm.

```bash
git clone https://github.com/calvin11527/crewtopus.git
cd crewtopus/src
npm run setup          # installs workspaces
npm run dev            # API http://localhost:3000 · UI http://localhost:5173
```

In a **second terminal** (with `dev` still running):

```bash
cd crewtopus/src
npm run demo           # mock implement → test → review pipeline
```

Then open **http://localhost:5173/board**, click the new story, and watch the agent console.

No Grok, Copilot, Claude, or Ollama required for this path — it uses the built-in **Mock Agent**.

| Service | URL |
|---------|-----|
| UI | http://localhost:5173 |
| API | http://localhost:3000 |

### In the UI (same mock path)

1. Open **Scrum Board**  
2. Click **Multi-agent demo** (runs mock pipeline)  
3. Open the card → **Agent console** + history  

---

## Who it's for

| You want… | Crewtopus |
|-----------|-----------|
| Process around agents you already use (Grok / Copilot / Claude / Ollama) | Yes |
| Local-first board + lifecycle on *your* machine | Yes |
| Fully unattended production deploys | Not yet — human review still matters |
| Multi-tenant cloud SaaS | No (local orchestration) |

---

## Crewtopus vs “just chat”

| | Chat / single agent | Crewtopus |
|--|---------------------|-----------|
| Work tracking | Transcript | Kanban epics / stories / tasks |
| Roles | One prompt | BA, PM, developer, tester, reviewer |
| Failures | Restart chat | Retry, audit, board status |
| Quota | Stuck | Switch adapter, same staffed role |
| Privacy | Hope | Best-effort secret scan before outbound context |

---

## Real agents (after the mock demo)

1. **Agents** — set adapter (Grok, Copilot, Claude, Ollama, …) and model. Over quota? Change adapter type on the same role.  
2. **Workspaces** — link a local project folder.  
3. **Board** — create a sprint, staff BA / PM / developers.  
4. Add a **story** → **Full lifecycle** (BA → PM tasks → developer pipeline).  
5. Watch **Live Activity** / work-item console.

Optional infra (Redis, Ollama, Prometheus, Grafana):

```bash
cd src
npm run infra:up
```

---

## Configuration

See **[.env.example](./.env.example)**.

| Variable | Purpose |
|----------|---------|
| `PORT` | Backend HTTP port (default `3000`) |
| `AGENTHUB_WORK_DIR` | Agent work artifacts *(legacy prefix; still used)* |
| `AGENTHUB_DB_PATH` | SQLite path |
| `OLLAMA_HOST` | Local Ollama URL |
| `GROK_*` / `COPILOT_*` | Adapter CLI paths, timeouts, permissions |

---

## Project layout

```
crewtopus/
├── README.md
├── LICENSE                 # MIT
├── CONTRIBUTING.md
├── SECURITY.md
├── docs/
│   ├── ROADMAP.md
│   ├── assets/             # Logo & demo GIF
│   └── wiki/               # Wiki source
└── src/
    ├── backend/            # Express + WebSocket + SQLite
    ├── frontend/           # React + Vite UI
    ├── infra/              # Docker Compose / k8s
    ├── scripts/            # demo + automation proofs
    └── package.json
```

---

## Architecture

```
Frontend (React)  ──REST/WS──▶  Backend (Express)
                                    ├── Agent adapters (CLI + mock)
                                    ├── Lifecycle (BA / PM / pipeline)
                                    ├── Privacy guard + audit
                                    └── SQLite + optional Redis
```

---

## Known limitations (honest)

- Best on **trusted local repos**; not a hardened multi-tenant server.  
- Real CLI adapters need those tools installed and authenticated.  
- “Crew = process” is a **harness** — quality still depends on models, prompts, and human review.  
- Pre-1.0 (`v0.x`) — APIs and UX may change.

See [docs/ROADMAP.md](./docs/ROADMAP.md).

---

## Documentation

- [CONTRIBUTING.md](./CONTRIBUTING.md) — setup, tests, PR tips  
- [docs/ROADMAP.md](./docs/ROADMAP.md) — near-term priorities  
- [SECURITY.md](./SECURITY.md)  
- [GitHub Wiki](https://github.com/calvin11527/crewtopus/wiki) · source in [`docs/wiki/`](./docs/wiki/)  
- [src/README.md](./src/README.md) · [src/infra/README.md](./src/infra/README.md)

---

## Contributing

Issues and PRs welcome. Good first issues: [`good first issue`](https://github.com/calvin11527/crewtopus/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

```bash
cd src && npm test
```

---

## License

[MIT](./LICENSE) © Crewtopus Contributors

Earlier commits briefly used PolyForm Noncommercial; **current `main` is MIT**.

---

*Many tentacles, one delivery.*
