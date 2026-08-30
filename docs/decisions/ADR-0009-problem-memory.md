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
An approved `persistent-instruction` resolution may materialize one scoped
rule under `.claude/hooks/docs/problem-memory/`; writing `AGENTS.md` is not an
automatic path because it would broaden the rule beyond the recurring problem.

Persist records as SQLite tables in the project-local state directory using WAL
mode and parameterized statements. Bound and redact evidence before persistence.
Fail open with a diagnostic if the store is unavailable.

## Consequences

The first occurrence is not lost, equivalent events can be correlated without
fragile text matching, and decisions remain reviewable. Semantic matching is
disabled initially to avoid false merges until a separately reviewed matcher is
available.
