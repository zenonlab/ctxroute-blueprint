---
scope:
  - .codex/hooks/problem-memory.mjs
  - .codex/hooks/lifecycle.mjs
  - ctxroute-config.json
  - tests/problem-memory.test.mjs
review: on-change
revised: true
---
# ADR-0009 — Durable recurring-problem memory

- Status: accepted
- Date: 2026-08-30

## Context

CTXRoute must recognize recurring problems without relying on raw error text or
repeating questions already answered by the user. The existing lifecycle
dispatcher and local SQLite/WAL state are the common infrastructure.

## Decision

Record the first observation from `UserPromptSubmit` and `PostToolUse`, then
derive a deterministic signature from structured event fields, normalized
message data, target paths, and cleaned stack locations. Match in order of
exact signature, structural signature, and optional semantic matching. Low
confidence matches remain separate records.

Keep problem recording separate from recurrence promotion. The configured
problem recurrence threshold is independent from CTXRoute's generic threshold.
When a recurring record has no known resolution, emit an auditable proposal;
automatic hook activation is never performed by the memory hook. A protection
must be scoped, validated, and approved by the agent control boundary.
Approved resolutions are recorded through the controlled `resolve` command and
are injected on later recurrences as context. The command never activates a
hook or changes agent trust settings.
An approved `persistent-instruction` resolution may materialize one CTXRoute
rule per file/tool pair under `.claude/hooks/docs/problem-memory/`. Each rule
uses only CTXRoute vocabulary: an exact `tool` trigger, a repository-relative
`scope`, and an explicit cadence. Legacy `problem-memory`, `events`, and
`tools` front-matter keys are never generated. Ambiguous, absolute, globbed,
or parent-traversing scopes are rejected. Writing `AGENTS.md` is not an
automatic path because it would broaden the rule beyond the recurring problem.

SQLite remains detection and resolution memory only. CTXRoute remains the
injection engine, and the local hook remains a proposal/resolution adapter;
approved protections do not alter permissions, global configuration, or
repository doctrine. The same boundary applies to ADR context: valid ADRs are
mirrored into ignored `.claude/hooks/docs/adr-memory/` documents, and CTXRoute
alone injects the mirrored body.

ADR metadata remains matched by repository-relative scope. Invalid or
superseded ADRs block governed changes until repaired or replaced. Multiple
applicable ADRs are reported as `partial`; semantic contradiction between
their texts is outside scope until a dedicated analyzer exists.

Persist records as SQLite tables in the project-local state directory using WAL
mode and parameterized statements. Bound and redact evidence before persistence.
Fail open with a diagnostic if the store is unavailable.

## Consequences

The first occurrence is not lost, equivalent events can be correlated without
fragile text matching, and decisions remain reviewable. Semantic matching is
disabled initially to avoid false merges until a separately reviewed matcher is
available.

On Node.js releases that still label `node:sqlite` experimental, the lifecycle
dispatcher removes that exact stability warning before producing agent-facing
output. Other standard-error diagnostics remain visible and fail-open behavior
is unchanged.
