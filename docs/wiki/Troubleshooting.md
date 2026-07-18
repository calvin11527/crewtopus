# Troubleshooting

## Agent fails: process timed out

- BA/PM Copilot runs can need longer timeouts (defaults were raised for planning).
- Ensure write permissions for analysis/planning (requirements files).
- Check Live Activity for the real error (model unavailable, permission denied).

## No tasks created after Full lifecycle

Full lifecycle is **BA → PM → create tasks**. If BA fails, PM never runs and no child tasks appear. Fix BA first, then re-run.

## Over budget / over quota

- Credits and quotas are **per adapter type**.
- Switch adapter (e.g. to Ollama/Grok) or raise/clear limits under **Configure agent**.
- Ollama is typically unlimited in the credit UI.

## Model not available

- Copilot may only allow `auto` on some plans; Crewtopus can fall back to `auto`.
- Pick a model from the catalog or enter a valid custom id.

## Work directory / workspace issues

- Link a valid folder on the Workspaces page.
- Set `AGENTHUB_WORK_DIR` if artifacts should live outside the default path.

## CLI not found

Install and authenticate the agent CLI on your PATH (`grok`, `copilot`, `claude`, `ollama`, …). Use **Mock** for UI-only demos.

## Still stuck?

Open a [GitHub issue](https://github.com/calvin11527/crewtopus/issues) with:

- Adapter type and model  
- Steps to reproduce  
- Relevant log lines (redact secrets)  
