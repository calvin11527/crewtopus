# Contributing

Thanks for helping Crewtopus grow.

## Ground rules

1. Open an issue before large design changes.
2. Keep PRs focused; include tests for behavior changes.
3. Never commit secrets, personal home paths, or runtime DBs.
4. Run tests before submitting:

```bash
cd src
npm test
```

## Dev setup

See [Getting Started](Getting-Started).

## Code layout

- `src/backend` — Express API, adapters, lifecycle  
- `src/frontend` — React UI  
- `src/infra` — Docker / k8s  

## License

By contributing, you agree that contributions are licensed under the [MIT License](https://github.com/calvin11527/crewtopus/blob/main/LICENSE).

Full contributor guide: [CONTRIBUTING.md](https://github.com/calvin11527/crewtopus/blob/main/CONTRIBUTING.md).
