# Crewtopus roadmap

Living roadmap for adoption and product maturity. Order is intentional: **activation before features**.

## Now (adoption)

- [x] Short UI demo GIF on README
- [x] Mock pipeline demo (`npm run demo`) without paid CLIs
- [x] Conversion-oriented README (problem → 60s demo → full setup)
- [x] MIT license for community use
- [x] CONTRIBUTING + issue templates
- [x] One-command Docker demo (`./demo.sh`) — UI + API + mock approved
- [x] Mock demo ends cleanly as `loopStatus=approved` / `status=done`
- [ ] Public case study: real repo + one finished story write-up

## Next (trust on non-toy repos)

- [x] Real-time-ish credit usage (WS after runs, Sync now, throttle signals)
- [x] Capability learning + improvement suggestions (opt-in apply)
- [x] SuperGrok weekly bookmarklet + paste parser
- [x] First-run onboarding wizard + board empty-state CTAs
- [x] Auto adapter failover on quota + Apply suggestion type switch
- [x] Optional API token auth (`CREWTOPUS_API_TOKEN`)
- [x] Sprint report export (Board → Report)
- [x] `/api/ready` readiness probe
- [ ] Workspace onboarding wizard (pick folder → first story)
- [ ] Optional file watchers for outside-Crewtopus CLI usage (`AGENTHUB_WATCH_PROVIDER_USAGE`)

## Later

- [ ] Hardened optional auth for LAN exposure
- [ ] Richer eval harness defaults for production pipelines
- [ ] Plugin-style adapter registration docs

## Non-goals (for now)

- Multi-tenant cloud SaaS
- Fully unattended production deploys without human review
- Replacing your IDE — Crewtopus orchestrates **process**, not the editor

## Feedback

Open a [GitHub Discussion](https://github.com/calvin11527/crewtopus/discussions) or [issue](https://github.com/calvin11527/crewtopus/issues).  
Good first issues are labeled `good first issue`.
