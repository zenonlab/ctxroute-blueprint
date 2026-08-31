---
scope:
  - .githooks/sensor-engine.mjs
  - .githooks/sensor-checklist.mjs
  - .codex/hooks/post-tool-sensor.mjs
  - .project/sensor-rules.json
  - package.json
  - docs/architecture/src/blueprint.architecture.json
  - docs/00-project-brief.md
  - docs/02-quality-strategy.md
  - tests/sensor.test.mjs
  - tests/post-tool-sensor.test.mjs
review: on-change
revised: true
contracts:
  - package.json
---
# ADR-0011 — Sensor coverage registry and checklist

## Decision

The Sensor keeps one executable adapter registry. Syntax-aware adapters remain
separate from lexical adapters, so support for a file extension never implies
AST or whole-program guarantees. The first lexical set covers common Rust,
Go, JVM, native, scripting, and configuration formats including Rust and TOML;
additional languages require an explicit registry entry and tests.

The repository exposes `npm run sensor:checklist` as a read-only CLI. It reports
the registry, bounded analysis contract, required configuration, architecture,
and test evidence in human-readable or `--json` form. It does not modify files,
permissions, hooks, or global configuration.

## Consequences

PostToolUse recognizes the same registry extensions as the CLI. Lexical support
only masks comments and strings before a small high-confidence check; it does
not claim a grammar, type analysis, SQL dataflow, or runtime behavior proof.
Unsupported extensions still produce explicit `ERROR` when passed directly to
the Sensor.

## Alternatives

Claiming universal language support would hide false negatives. Installing a
parser for every ecosystem would add unreviewed dependencies to a stack-neutral
blueprint. A generated checklist that edits policy would exceed its audit role.
