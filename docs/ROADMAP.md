# Crewtopus roadmap

Living roadmap for adoption and product maturity. Order is intentional: **activation before features**.

## Now (adoption)

- [x] Short UI demo GIF on README
- [x] Mock pipeline demo (`npm run demo`) without paid CLIs
- [x] Conversion-oriented README (problem → 60s demo → full setup)
- [x] MIT license for community use
- [x] CONTRIBUTING + issue templates
- [ ] One-command Docker “UI + mock” stack (optional infra path)
- [ ] Public case study: real repo + one finished story write-up

## Next (trust on non-toy repos)

- [ ] Stronger cold start: empty DB → welcome sprint already staffed with Mock Agent
- [ ] Clearer failure UX when a CLI adapter is missing (actionable error → switch adapter)
- [ ] Export “sprint report” (what ran, verdicts, audit links) for sharing
- [ ] Workspace onboarding wizard (pick folder → first story)

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
