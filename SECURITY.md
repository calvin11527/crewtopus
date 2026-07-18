# Security Policy

## Supported versions

Security fixes are accepted against the default branch. Pre-1.0 releases (`v0.x`) may include breaking changes; upgrade when advisories are published.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report privately using:

1. **GitHub Security Advisories** — [Report a vulnerability](https://github.com/calvin11527/crewtopus/security/advisories/new) on this repository (preferred).
2. If Advisories are unavailable, contact the repository owner via GitHub without posting exploit details publicly.

Include:

- Affected version / commit
- Impact (RCE, data leak, privilege escalation, etc.)
- Minimal reproduction steps
- Whether a fix is already known

## Threat model (important)

Crewtopus is a **local multi-agent orchestration platform**. It is designed to run on a trusted developer machine, not as an unauthenticated public SaaS.

### High privilege by design

Agent adapters may invoke CLI tools (Grok, Copilot, Claude, Ollama, etc.) with **broad filesystem and tool access**, including modes equivalent to:

- Allowing shell / tool execution
- Writing under workspaces and agent work directories
- Reading repository context for planning and implementation

**Implications:**

- Treat Crewtopus like a local IDE agent: only point it at **repos and workspaces you trust**.
- Do **not** expose the backend HTTP/WebSocket API to the public internet without authentication, network isolation, and a hardened deployment plan.
- Default assumption: anyone who can call the API can trigger agent runs that modify files and execute tools.

### Secrets and privacy

- Crewtopus includes a **privacy guard** that scans for common secret patterns in context. It is a best-effort control, not a guarantee.
- Never commit `.env`, API keys, or production credentials. Use `.env.example` as a template only.
- Runtime data (SQLite DB under `src/backend/data/`, `.agenthub-work/`, CLI stream logs) may contain **local paths and work product**. These paths are gitignored; do not publish them.

### Out of scope

- Vulnerabilities solely in third-party agent CLIs or their cloud backends
- Issues that require an already-compromised local machine
- Misconfiguration by operators who intentionally expose the API without auth

### In scope

- Backend API / WebSocket abuse
- Path traversal or unsafe workspace handling
- Bypass of privacy-guard secret redaction in Crewtopus-controlled pipelines
- Injection via work-item prompts that causes unintended platform behavior beyond intended agent tool use

## Hardening recommendations

1. Run backend bound to `localhost` only unless you add auth.
2. Keep `AGENTHUB_WORK_DIR` on a dedicated directory; avoid pointing it at your entire home folder.
3. Prefer least-privilege agent adapters when possible; understand that implementation phases often require write access.
4. Rotate any provider tokens if they may have been logged in stream output.
5. Review audit logs after sensitive runs.

## Supply chain

- Keep Node.js and dependencies updated.
- Prefer installing from tagged releases.
- Review `package-lock.json` changes in pull requests.
