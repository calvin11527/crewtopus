# Agents & Adapters

## Concepts

- **Agent** — a named crew member (hired / registered), staffed onto sprint roles.
- **Adapter type** — which CLI/provider runs work: `grok`, `copilot`, `claude`, `ollama`, `antigravity`, `mock`.
- **Model** — provider-specific model id (e.g. `auto`, `grok-4.7`, Ollama tag).

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

## Grok run defaults

Crewtopus spawns the `grok` binary. It does not use `grok agent` (that is a different process: stdio, headless, or serve).

| Setting | Default | Override |
|---------|---------|----------|
| Model | `grok-4.7` | Per-agent model, or `GROK_DEFAULT_MODEL` |
| Effort | `medium` (`--effort`) | Per-agent effort, then `GROK_EFFORT` |
| Turn cap | `--max-turns 30` | `GROK_MAX_TURNS` (`0` omits the flag) |
| Plan mode | `--no-plan` | `GROK_NO_PLAN=false` |

`grok-4.7-build-fast` stays in the model list. It is faster and costs twice as much, so it is not the default.

`--max-turns` stops one pass from spinning on tool calls. `--no-plan` skips Grok's own planner because the crew already runs implement, then test, then review. A review step whose permission mode is `plan` does not pass `--no-plan`.

Flags left off on purpose: `--verbatim`, `--sandbox`, `--disable-web-search`, and `--no-subagents`. Subagents stay available inside the turn cap. Web search stays available for tasks that need current docs.

Existing Grok agents whose stored model is empty, `grok-4.5`, or `grok-4.6` move to `grok-4.7` on the next backend start. An empty effort becomes `medium`. A chosen fast or custom model, and any saved effort, stay as they are.

## Permissions note

Implementation and lifecycle (BA/PM) phases often need **file write** access in the work directory. Treat the machine as trusted — see [Security](Security).
