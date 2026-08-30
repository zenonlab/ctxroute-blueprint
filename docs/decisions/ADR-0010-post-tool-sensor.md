---
scope:
  - .githooks/sensor
  - .githooks/sensor-engine.mjs
  - .codex/hooks/post-tool-sensor.mjs
  - .codex/hooks/post-tool-audit.mjs
  - .codex/hooks/lifecycle.mjs
  - .project/sensor-rules.json
  - docs/architecture/src/blueprint.architecture.json
  - docs/00-project-brief.md
  - docs/02-quality-strategy.md
  - tests/sensor.test.mjs
  - tests/post-tool-sensor.test.mjs
review: on-change
revised: true
---
# ADR-0010 — Multilingual PostToolUse Sensor

- Status: accepted
- Date: 2026-08-30

## Decision

PostToolUse reuses the existing path extraction and invokes one Sensor engine
with registered adapters for JavaScript, TypeScript, JSX/TSX, Python, SQL,
HTML, CSS, Vue, and Svelte. Rules are versioned configuration and each
diagnostic has a stable rule identifier and JSON contract. AST parsing is used
where grammars exist; markup and single-file-component adapters mask comments
and strings before structural checks and delegate embedded script/style blocks
to the existing language adapters.

CTXRoute remains the context-injection and guidance layer. Sensor diagnostics
are returned in the agent context, while SQLite problem memory may retain
recurrences independently. No hook edits AGENTS.md, permissions, or global
CTXRoute configuration. UNSAFE and ERROR results block subsequent validation
or commit controls; WARN results remain informational.

Configured SQL sinks in JS/TS/Python are analyzed as well as standalone SQL
files. Optional `requireLimit` detects unbounded result sets, and optional
`requireRateLimit` warns when a request-scoped operation lacks a configured
guard such as `rateLimit` or `throttle`. Neither option makes a runtime rate
limit or query allowlist policy mandatory for derived products; enforcement
remains an application responsibility.

The default sink registry covers common raw/query entry points used by Prisma,
Knex, TypeORM, Sequelize, Django, and SQLAlchemy. Derived products can replace
that registry in `sql.sinks`; safe parameterized APIs are not marked unsafe just
because they belong to an ORM. Tagged SQL builders such as `sql` and
`Prisma.sql` are configurable through `sql.safeBuilders`; raw variants remain
analyzable sinks.

Products may also opt into `requireMutationFilter` to classify unfiltered
`UPDATE` and `DELETE` statements as `UNSAFE`; this is disabled by default for
migrations and maintenance jobs. A parameterized `LIMIT` is accepted as a
bound, but its runtime maximum remains a product responsibility.

The SQL check also follows dynamic query builders and variables within the
same parsed file. It is intentionally not whole-program taint analysis, so
framework-specific sinks and cross-module flows require explicit adapter work.

For an explicit multi-file scan, the bounded tracker follows exported
JavaScript/TypeScript builders and module-level Python builders when the
consuming file imports them. It resolves relative JS/TS imports, local Python
modules, CommonJS destructuring/member aliases, and simple ES/Python aliases;
namespace member calls are supported when the referenced module is part of the
same scan. Same-name exports from unrelated modules are not conflated. Package
imports and arbitrary dynamic module resolution are intentionally not inferred.
It propagates configured HTTP, environment, and CLI taint sources through local
variables and imported builders.

The versioned Sensor configuration is validated before scanning. A missing,
malformed, or incompatible rules file produces `sensor/configuration` with an
`ERROR` verdict instead of falling back to an implicit safe policy.

PostToolUse analyzes the new path of a rename and skips an intentionally
deleted path; an unexpectedly absent path during another mutation remains an
explicit `sensor/read-error`. Invalid hook input is reported visibly while the
hook fails open.

High-confidence injection and execution risks are UNSAFE. UI layering and
anti-slop findings are WARN by default. Unsupported or absent files produce
explicit ERROR diagnostics and are never treated as safe. Adding an adapter or
rule does not require changing the CTXRoute dispatcher.

## Alternatives

A universal regex scanner would create false positives in comments and
strings. Installing anti-slop as an unreviewed fixed dependency would transfer
unbounded policy into the blueprint. Product-specific framework rules remain
out of scope until the framework is explicitly selected.
