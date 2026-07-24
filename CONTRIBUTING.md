# Contributing to Crewtopus

Thanks for helping. Crewtopus is local multi-agent orchestration for software delivery — board-first, adapter-switchable, with a mock path so you can develop without paid CLIs.

## Quick setup

```bash
git clone https://github.com/calvin11527/crewtopus.git
cd crewtopus/src
npm run setup    # npm install (workspaces)
npm run dev      # API :3000 + UI :5173
```

**One-command Docker demo** (Docker Desktop required):

```bash
./demo.sh          # build + start + mock pipeline → approved
./demo.sh down
```

**Local mock demo** (no Grok/Copilot): with `npm run dev` in another terminal:

```bash
cd src
npm run demo
```

## Development

```bash
cd src
npm test           # backend + frontend
npm run build
npm run test:single-story   # needs backend up; uses mock demo pipeline
```

### Layout

| Path | Role |
|------|------|
| `src/backend` | Express API, adapters, lifecycle, SQLite |
| `src/frontend` | React + Vite UI |
| `src/infra` | Docker Compose / k8s (optional) |
| `docs/` | Assets, design notes, wiki source |

### Conventions

1. **Open an issue** for large changes before a big PR.
2. Keep PRs focused; add/adjust tests when behavior changes.
3. Never commit secrets, tokens, or personal machine paths.
4. Prefer mock/demo paths in automated tests when real CLIs are not required.
5. Legacy env/DB prefixes may still say `AGENTHUB_*` — keep them for compatibility unless you are doing a coordinated rename.

## Pull requests

- Branch from `main` (or the repo default).
- Describe *why* and how to verify.
- Run `npm test` under `src/` before submitting.
- UI changes: note any screenshots if layout shifts.

## Security

Do **not** open public issues for vulnerabilities. See [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
