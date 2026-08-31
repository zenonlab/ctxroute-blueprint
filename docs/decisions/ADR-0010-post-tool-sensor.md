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
with registered syntax-aware and lexical adapters for JavaScript, TypeScript,
JSX/TSX, Python, SQL, HTML, CSS, Vue, Svelte, Rust, TOML, and other declared
common formats. Rules are versioned configuration and each
diagnostic has a stable rule identifier and JSON contract. AST parsing is used
where grammars exist; markup and single-file-component adapters mask comments
and strings before structural checks and delegate embedded script/style blocks
to the existing language adapters.

The registry also recognizes common extensionless repository files
(`Dockerfile`, `Makefile`, `Justfile`) and environment files (`.env`,
`.env.example`, `.env.local`). The complete registry is the source of truth for
PostToolUse and the read-only coverage checklist; lexical coverage does not
claim parser, type, or runtime semantics.

Diagnostics also carry `confidence` and `category` fields, and the CLI can emit
SARIF 2.1.0 with `--sarif` for code-scanning integrations. This is an export
format only; it does not change verdicts or make a product's CI provider a
blueprint dependency.

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
Knex, TypeORM, Sequelize, Django, SQLAlchemy, SQLite drivers, and async database
clients. Derived products can replace that registry in `sql.sinks`; safe
parameterized APIs are not marked unsafe just because they belong to an ORM.
Tagged SQL builders such as `sql` and
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

AST parsing is bounded to 32,000 UTF-8 bytes per source. Larger syntax-aware
files use the lexical adapter and receive an explicit `WARN` diagnostic so the
parser limit cannot be mistaken for a clean AST result or an internal crash.

The result also declares its coverage limits: `moduleScope` is
`explicit-paths`, package resolution is disabled, `wholeProgramAnalysis` is
false, and `rateLimitRuntimeProof` is false. Local import resolution may only
match files included in the same `analyzePaths` action; a `SAFE` result never
means that an unscanned dependency is safe or that a rate-limit middleware was
executed at runtime. Ruby/Rails source uses a bounded lexical adapter for Ruby,
Rake, Rack, and Rails conventions, while ERB/Haml/Slim and common
server-rendered template formats use an embedded template adapter. It detects
high-confidence Ruby SQL interpolation/concatenation and dangerous Rails
boundaries such as dynamic command execution, request-controlled file output,
and unsafe rendering. ORM calls with ordinary parameter values remain outside
the SQL injection rule. New languages are added through the adapter registry;
product-specific sinks, builders, taint sources, and thresholds are added in
the versioned rules file.

PostToolUse analyzes the new path of a rename and skips an intentionally
deleted path; an unexpectedly absent path during another mutation remains an
explicit `sensor/read-error`. Invalid hook input is reported visibly while the
hook fails open.

The repository pre-commit validation reuses the same Sensor rules against the
staged blob contents. `UNSAFE` and `ERROR` diagnostics therefore block a commit
without analyzing a different working-tree version; `WARN` diagnostics remain
informational. This is a Git validation boundary, not an attempt to undo the
already completed PostToolUse write.

High-confidence injection and execution risks are UNSAFE. UI layering and
anti-slop findings are WARN by default. Unsupported or absent files produce
explicit ERROR diagnostics and are never treated as safe. Adding an adapter or
rule does not require changing the CTXRoute dispatcher.

## Alternatives

A universal regex scanner would create false positives in comments and
strings. Installing anti-slop as an unreviewed fixed dependency would transfer
unbounded policy into the blueprint. Product-specific framework rules remain
out of scope until the framework is explicitly selected.
