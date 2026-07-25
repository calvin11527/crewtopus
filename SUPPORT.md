# Support

## Getting help

1. **Docs** — [README](./README.md), [Getting Started wiki](./docs/wiki/Getting-Started.md), [Architecture](./docs/ARCHITECTURE.md)
2. **SuperGrok sync** — [bookmarklet guide](./docs/supergrok-bookmarklet.md) · in-app `/supergrok-sync.html`
3. **Bugs** — [GitHub Issues](https://github.com/calvin11527/crewtopus/issues) (use the bug template)
4. **Ideas** — [Discussions](https://github.com/calvin11527/crewtopus/discussions) if enabled
5. **Security** — [SECURITY.md](./SECURITY.md) (private advisories only)

## Quick diagnostics

```bash
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3000/api/ready
cd src && npm run demo    # mock pipeline, no paid CLIs
./quickstart.sh           # install + dev + open UI + demo
./demo.sh                 # Docker one-command stack
```

## What we can and cannot support

| Supported | Not supported (yet) |
|-----------|---------------------|
| Local single-user orchestration | Multi-tenant SaaS |
| Mock + major CLI adapters | Guaranteed 1:1 SuperGrok billing mirror without sync |
| Best-effort privacy scan | Hardened internet-facing deploy without your own auth/proxy |
