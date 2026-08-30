# Project brief

## Summary

- Name: CTXRoute Blueprint transition infrastructure
- Problem solved: provide reproducible workspace coordination, bounded CRG updates, and explicit agent governance around existing blueprint tooling.
- Users: contributors and coding agents working in the three-repository workspace.
- In scope: npm workspace foundation, Node.js watcher, ephemeral `uvx code-review-graph update`, SQLite/WAL lifecycle, resource/error/concurrency controls, governance boundaries, architecture evidence, and CI.
- Out of scope: changing CTXRoute, replacing Archify or Sensor, a persistent Python service, and duplicating issue #7 multilingual post-hook analysis.

## Constraints

- Performance: coalesce file events, allow one CRG update at a time, terminate each subprocess after completion, and keep memory bounded for Apple Silicon and CI runners.
- Security: no dynamic evaluation or shell interpolation; validate paths, use fixed argument vectors, avoid secrets in diagnostics, and preserve ASK/NEVER/ALWAYS escalation boundaries.
- Reliability: recover from failed updates, handle SIGINT/SIGTERM, close SQLite connections cleanly, and keep the blueprint usable when CRG is unavailable.
- Platform: Node.js 22/npm 10; Linux, macOS, and Windows; no daemon or hosted service.

## Decisions

- Language and runtime: JavaScript ES modules on Node.js 22; Python only through ephemeral `uvx`.
- Frontend: none; Archify HTML is documentation output.
- Backend: none; behavior is local CLI/workspace orchestration.
- Storage: local SQLite configured with WAL for CRG state; no remote persistence.
- Tests: Node.js built-in test runner for unit, integration, contract, and performance checks.
- Deployment: source repository and GitHub Actions only; no production deployment.
- Observability: stable JSON diagnostics plus bounded lifecycle logs without secrets.

## Success criteria

- `npm ci` and root commands work from a clean clone on Node.js 22.
- Workspace packages are discoverable through npm workspaces without changing blueprint status semantics.
- File events produce at most one bounded CRG subprocess per coalesced update and leave no persistent Python process.
- SQLite uses WAL and closes cleanly on success, failure, and signal.
- Governance rules make ASK, NEVER, and ALWAYS decisions explicit and auditable.
- Architecture, tests, Sensor diagnostics, and Linux/macOS/Windows CI remain green.
