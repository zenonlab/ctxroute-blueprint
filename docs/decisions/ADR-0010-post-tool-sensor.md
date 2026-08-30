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
HTML, and CSS. Rules are versioned configuration and each diagnostic has a
stable rule identifier and JSON contract. AST parsing is used where grammars
exist; markup adapters mask comments and strings before structural checks.

CTXRoute remains the context-injection and guidance layer. Sensor diagnostics
are returned in the agent context, while SQLite problem memory may retain
recurrences independently. No hook edits AGENTS.md, permissions, or global
CTXRoute configuration. UNSAFE and ERROR results block subsequent validation
or commit controls; WARN results remain informational.

Configured SQL sinks in JS/TS/Python are analyzed as well as standalone SQL
files. Optional `requireLimit` detects unbounded result sets without making a
rate-limit or query allowlist policy mandatory for derived products. A
rate-limit gateway remains an application responsibility.

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
