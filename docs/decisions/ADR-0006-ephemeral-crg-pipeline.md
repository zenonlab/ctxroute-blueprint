---
scope:
  - scripts/watch-crg.mjs
  - .ctxroute/state/code-review-graph.sqlite
review: on-change
revised: true
superseded-by: ADR-0018-official-code-review-graph.md
---
# ADR-0006 — Ephemeral CRG update pipeline

- Status: superseded by ADR-0018
- Date: 2026-08-30

## Context

CRG updates must react to local changes without leaving a Python process or
unbounded resource usage behind.

## Decision

Use a Node.js watcher with burst coalescing and single-flight execution. Start
`uvx code-review-graph update` as a child process with fixed arguments, bounded
stdio and cancellation, then exit it after the update. Configure SQLite with
WAL for local update state and close the database before reporting completion.

## Alternatives

A persistent Python daemon increases memory residency and shutdown complexity.
Uncoalesced events create process storms. A remote database violates local
blueprint constraints.

## Consequences

Updates may be delayed by the debounce window, but concurrency and resource
usage are predictable. CRG failures are observable and do not corrupt the
workspace or create a resident service. The implementation stores a bounded
execution record in the local WAL database and exposes a native watcher CLI.
Shutdown propagates an `AbortSignal` to the active child so cancellation is
explicit and testable.
