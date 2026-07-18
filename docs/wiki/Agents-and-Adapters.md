# Agents & Adapters

## Concepts

- **Agent** — a named crew member (hired / registered), staffed onto sprint roles.
- **Adapter type** — which CLI/provider runs work: `grok`, `copilot`, `claude`, `ollama`, `antigravity`, `mock`.
- **Model** — provider-specific model id (e.g. `auto`, `grok-build`, Ollama tag).

Budget and hard blocks are tracked **per adapter type**, not per model. Switching model alone may not unblock a provider that is over quota.

## Switching adapter (Copilot → Grok, etc.)

1. **Agent Registry** → **Adapter / model**
2. Change **Provider**
3. Pick a **model** for the new provider
4. Confirm the switch and save

Sprint assignments keep the same agent id — only the backend adapter changes.

You cannot change adapter while the agent status is **running**.

## Supported adapters (overview)

| Adapter | Typical use |
|---------|-------------|
| **Grok** | Grok CLI coding / analysis |
| **Copilot** | GitHub Copilot CLI |
| **Claude** | Claude Code CLI |
| **Ollama** | Local models (unlimited by default in credit UI) |
| **Mock** | Tests / demos without a real CLI |

Install and authenticate each CLI yourself; Crewtopus invokes them as subprocesses.

## Permissions note

Implementation and lifecycle (BA/PM) phases often need **file write** access in the work directory. Treat the machine as trusted — see [Security](Security).
