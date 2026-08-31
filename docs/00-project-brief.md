# Project brief

## Summary

- Name: CTXRoute Blueprint transition infrastructure
- Problem solved: provide reproducible workspace coordination, bounded CRG updates, and explicit agent governance around existing blueprint tooling.
- Users: contributors and coding agents working in the three-repository workspace.
- In scope: npm workspace foundation, Node.js watcher, ephemeral `uvx code-review-graph update`, SQLite/WAL lifecycle, resource/error/concurrency controls, governance boundaries, architecture evidence, and the extensible multilingual PostToolUse Sensor.
- Out of scope: changing CTXRoute, replacing Archify, a persistent Python service, and imposing Sensor rules on derived products.
- UI contract: provide framework-neutral tokens, component roles, states, accessibility expectations, and reuse guidance; framework-specific implementation remains a derived-product decision.

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
- Post-hook analysis: AST adapters cover JS/TS/JSX/TSX and Python; embedded/lexical adapters cover SQL, HTML, CSS, Vue/Svelte, 53 common source extensions, 18 data/config extensions, plus Dockerfile/Makefile/Justfile and `.env` names. The Sensor also reports high-confidence XSS, SSRF, path traversal, prototype pollution, weak crypto, open redirects, UI layering, and anti-slop findings, with optional SARIF output. All adapters share one Sensor engine; CTXRoute injects guidance and SQLite records recurrence without activating hooks. Lexical registration is coverage visibility, not a grammar or type-analysis guarantee.
- SQL policy: configured DB sinks are checked across JS/TS/Python; optional result-size `LIMIT`, mutation predicates, and request-scoped request-rate guards are distinct configurable checks. `LIMIT` bounds returned rows; `rateLimit`/`throttle` bounds requests. Runtime enforcement, effective quotas, schema/dialect validation, and query allowlists remain product responsibilities. Multi-file resolution is bounded to explicit scan paths; package and whole-program analysis are out of scope.
- Template/framework coverage: Ruby/Rails source and ERB/Haml/Slim, plus common server-rendered template families, use explicit lexical or embedded adapters; framework-specific enforcement remains opt-in and does not select a product stack.
- Diagnostic precision: every finding identifies its producing adapter and repeated identical findings are deduplicated deterministically. Blade PHP extraction is bounded and lexical; it is not a PHP AST or whole-program guarantee.

## Success criteria

- `npm ci` and root commands work from a clean clone on Node.js 22.
- Workspace packages are discoverable through npm workspaces without changing blueprint status semantics.
- File events produce at most one bounded CRG subprocess per coalesced update and leave no persistent Python process.
- SQLite uses WAL and closes cleanly on success, failure, and signal.
- Governance rules make ASK, NEVER, and ALWAYS decisions explicit and auditable.
- PostToolUse returns schema-versioned SAFE/WARN/UNSAFE/ERROR diagnostics plus explicit coverage metadata; UNSAFE/ERROR remain visible to validation and Git controls. A SAFE result is not runtime proof.
- Architecture, tests, Sensor diagnostics, and Linux/macOS/Windows CI remain green.
