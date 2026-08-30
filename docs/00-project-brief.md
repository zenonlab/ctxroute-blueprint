# Project brief

## Summary

- Name: CTXRoute Blueprint transition infrastructure
- Problem solved: provide reproducible workspace coordination, bounded CRG updates, and explicit agent governance around existing blueprint tooling.
- Users: contributors and coding agents working in the three-repository workspace.
- In scope: npm workspace foundation, Node.js watcher, ephemeral `uvx code-review-graph update`, SQLite/WAL lifecycle, resource/error/concurrency controls, governance boundaries, architecture evidence, and the extensible multilingual PostToolUse Sensor.
- Out of scope: changing CTXRoute, replacing Archify, a persistent Python service, and imposing Sensor rules on derived products.

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
- Post-hook analysis: JS/TS/JSX/TSX, Python, SQL, HTML, CSS, Vue, and Svelte adapters share one Sensor engine; CTXRoute injects guidance and SQLite records recurrence without activating hooks.
- SQL policy: configured DB sinks are checked across JS/TS/Python; optional result-size limits, mutation predicates, and request-scoped rate-limit guards are configurable, while runtime enforcement and query allowlists remain product responsibilities.

## Success criteria

- `npm ci` and root commands work from a clean clone on Node.js 22.
- Workspace packages are discoverable through npm workspaces without changing blueprint status semantics.
- File events produce at most one bounded CRG subprocess per coalesced update and leave no persistent Python process.
- SQLite uses WAL and closes cleanly on success, failure, and signal.
- Governance rules make ASK, NEVER, and ALWAYS decisions explicit and auditable.
- PostToolUse returns schema-versioned SAFE/WARN/UNSAFE/ERROR diagnostics; UNSAFE/ERROR remain visible to validation and Git controls.
- Architecture, tests, Sensor diagnostics, and Linux/macOS/Windows CI remain green.
