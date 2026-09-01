---
scope:
  - package.json
  - package-lock.json
  - eslint.config.mjs
  - .project/sensor-baseline.json
  - .project/context-benchmark.json
  - scripts/blueprint-sensor.mjs
  - scripts/context-benchmark.mjs
  - scripts/integration-check.mjs
  - .github/workflows/validate.yml
  - docs/02-quality-strategy.md
  - docs/architecture/src/blueprint.architecture.json
review: on-change
revised: true
---

# ADR-0017 — Executable blueprint quality gates

- Status: accepted
- Date: 2026-09-01

## Context

The repository validation command covered its contracts and tests but did not
enforce static linting, coverage thresholds, measured performance budgets, or a
whole-blueprint Sensor result. CI exercised the Sensor on one known-safe file,
which proved the CLI contract without proving that tracked tooling introduced
no new blocking diagnostic.

## Decision

Keep `npm run validate` as the deterministic repository gate. It runs ESLint,
contract and architecture validation, workspace and governance coherence, the
full tracked blueprint Sensor gate, bounded context benchmarks, and Node test
coverage thresholds of 85% lines, 70% branches, and 85% functions.

Use a small versioned Sensor baseline only for reviewed `UNSAFE` or `ERROR`
diagnostics in blueprint infrastructure. Every exception declares an exact
path/rule pair, expected occurrence count, and justification. Validation fails
for a new diagnostic, malformed exception, excess occurrence, or stale
exception. Informational `WARN` diagnostics remain visible without blocking.
SARIF contains only unexpected blocking diagnostics.

Keep benchmark thresholds in a separate versioned JSON contract. The measured
summary ratio, summary token count, and duration must satisfy those thresholds.
`npm run integration` smoke-tests the MCP stdio transport on supported local
platforms and validates manifests on Windows, where the GitHub runner transport
is not reliable. `npm run verify` adds the network dependency audit and the
generated documentation build to the deterministic validation gate.

Pin ESLint to the latest compatible major and declare its Node.js 22.13+ floor.
The blueprint remains JavaScript-only, so static lint and runtime contract tests
are required while a separate TypeScript typecheck remains not applicable.

## Consequences

Local and CI validation now fail on measurable regressions instead of only
recording artifacts. Baseline exceptions cannot silently grow or outlive the
diagnostics they justify. Network-dependent and generated-artifact checks stay
in `verify` so the core gate remains reproducible after dependencies exist.
