---
scope:
  - scripts/orchestrator-core.mjs
  - scripts/orchestrator-service.mjs
  - scripts/worktree-manager.mjs
  - .ctxroute/orchestrator/**
  - .ctxroute/recovery/**
  - tests/orchestrator-*.test.mjs
review: on-change
contracts:
  - .project/schemas/orchestrator/worktree-operation-v2.schema.json
---
# ADR-0025 — Recoverable worktree effects and V1 reset

- Status: accepted
- Date: 2026-09-06

## Decision

Every worktree effect is preceded by a persisted `PENDING` transaction and is
then inspected before the state records completion or a bounded blocking cause.
State writes use a same-directory 0600 temporary file, file fsync, atomic
rename, and directory fsync where supported. Locks contain a token, PID, and
timestamp; recovery requires an unchanged token, a dead local owner, and an
expired age.

At first orchestrator access, only a structurally valid V1 state is recognized.
Exactly its `state.json`, lock, and known same-directory temporary files are
removed, then an empty V2 state is installed atomically. Worktrees, reports,
and recovery proofs are never part of this reset. Corrupt JSON, unsafe paths,
and unknown or higher schema versions fail closed without deletion.

Reconciliation compares desired missions, Git worktree registrations, physical
directories, cleanliness, base revisions, locks, and disk budget. It removes
only clean worktrees belonging to terminal missions and prunes only metadata
whose path is truly absent. Dirty, unknown, symlinked, or ambiguous targets are
classified `NEEDS_ATTENTION` and are not recursively erased.

Rollback first captures bounded Git state, file inventory, digest, and a binary
restorable patch under `.ctxroute/recovery/`. Failed or oversized capture blocks
removal. A CLI-only purge is the sole no-proof path and requires orchestrator
authority, unique operation ID, reason, exact mission confirmation, and a
canonical target within the managed root.

## Consequences

Crashes converge by replaying `PENDING` intent. Git worktrees provide checkout
isolation, not hostile-process containment, and ambiguous local data always
requires operator attention.
