AgentHub Implementation Plan
Overview
Build a Tauri desktop application with Rust backend and React/TypeScript frontend that orchestrates multiple AI CLI agents (Claude Code, Grok, Copilot, Antigravity, Ollama) through a unified workflow engine with privacy controls, audit logging, and proactive automation.

Architecture Decision
The spec calls for Tauri + Rust + React. Given the complexity and the /goal directive, we will implement this as:

Backend: Node.js/Express + WebSocket server (practical for CLI orchestration, process spawning)
Frontend: React + TypeScript + Vite (as spec'd)
Storage: SQLite via better-sqlite3
Infrastructure: Docker Compose for Redis, Ollama, Prometheus, Grafana
Desktop wrapper: Electron-ready structure (Tauri Rust backend can be added later as an optimization)
Rationale: The spec's core value is in the orchestration logic, privacy guard, workflow engine, and agent adapters. Node.js provides the most practical foundation for spawning CLI processes, piping stdio, and rapid iteration. The frontend matches the spec exactly (React/TS/Vite).

Module Implementation Order
Phase 1: Foundation
Project scaffolding (package.json, tsconfig, vite config)
SQLite database schema & migrations
Backend server (Express + WebSocket)
Frontend shell (React + routing)
Phase 2: Core Modules
Module A: Workspace Management (CRUD + repository linking)
Module B: Agent Registry (dynamic registration, status)
Module C: Capability Registry (capability metadata, routing)
Module E: Supervisor Engine (central orchestration, no agent-to-agent bypass)
Phase 3: Execution
Module D: Workflow Engine (create/execute/pause/resume/cancel)
Module F: ContextScope Builder (file selection, diff, token limiting)
Agent Adapters (Claude, Grok, Copilot, Antigravity, Ollama, Mock)
Phase 4: Security & Audit
Module G: Privacy Guard (secret scanning, path sanitization, policy engine)
Module H: Approval Gate (approve/reject/modify scope)
Module I: Audit Logger (immutable logging)
Phase 5: Advanced
Module J: Proactive Engine (file watcher, git hooks, scheduled triggers)
Module K: Consensus Engine (majority/weighted vote, human review)
Phase 6: Infrastructure
Docker Compose (Redis, Ollama, Prometheus, Grafana)
k3d deployment manifests
Phase 7: Testing
Mock agents for deterministic testing
Unit tests, integration tests
Verification
npm run build compiles without errors
npm run dev launches the full application
Mock agent workflows execute end-to-end
Privacy guard blocks secrets in test payloads
Audit logs are written for all operations