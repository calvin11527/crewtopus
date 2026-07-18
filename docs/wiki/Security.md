# Security

**Canonical policy:** [SECURITY.md in the repo](https://github.com/calvin11527/crewtopus/blob/main/SECURITY.md)

## Short version

- Crewtopus runs agents with **broad local tool and filesystem access**.
- Use only on **trusted machines** and **trusted repositories**.
- Do **not** expose the API to the public internet without authentication.
- Report vulnerabilities **privately** via GitHub Security Advisories — not public issues.

## Operational tips

1. Bind the backend to localhost unless you add auth.
2. Keep `AGENTHUB_WORK_DIR` scoped (not your entire home directory).
3. Never commit `.env`, databases, or `.agenthub-work/` logs.
4. Rotate provider tokens if they appear in stream logs.
