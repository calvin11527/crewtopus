# Architecture index

Crewtopus is a local multi-agent orchestration platform.

```
Frontend (React + Vite)
    │ REST + WebSocket
    ▼
Backend (Express + SQLite)
    ├── Agent adapters (Grok, Copilot, Claude, Ollama, mock, …)
    ├── Outbound pipeline (privacy → approval → execute → audit)
    ├── Lifecycle (BA → PM → developer loop)
    ├── Usage meter + SuperGrok dashboard sync
    ├── Capability learning + suggestions
    └── Optional Redis / Docker / k8s (infra/)
```

## Key modules (`src/backend/src/modules/`)

| Module | Role |
|--------|------|
| `outbound-pipeline` | Single path for all agent calls |
| `adapter-failover` | Auto-switch when provider over quota |
| `work-item-pipeline` | Implement → test → review loops |
| `full-lifecycle` / `story-lifecycle` | BA / PM / queue |
| `agent-credits` / `usage-meter` | Usage display + throttle |
| `capability-learning` | Facts + improvement suggestions |
| `sprint-report` | Shareable sprint markdown report |
| `privacy-guard` | Secret scanning |

## Security

- Local trusted machine by default  
- Optional `CREWTOPUS_API_TOKEN` for API auth  
- See [SECURITY.md](../SECURITY.md)

## Further reading

- [src/README.md](../src/README.md)  
- [wiki/Architecture](./wiki/Architecture.md)  
- [COMPARISON.md](./COMPARISON.md)  
