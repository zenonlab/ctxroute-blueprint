---
scope:
  - scripts/orchestrator-core.mjs
  - scripts/orchestrator-service.mjs
  - scripts/worktree-manager.mjs
  - .ctxroute/orchestrator/**
  - .ctxroute/recovery/**
  - tests/orchestrator-*.test.mjs
review: on-change
revised: true
contracts:
  - .project/schemas/orchestrator/worktree-operation.schema.json
---
# ADR-0025 — Recoverable worktree effects

- Status: accepted
- Date: 2026-09-06

## Decision

Every worktree effect is preceded by a persisted `PENDING` transaction and is
then inspected before the state records completion or a bounded blocking cause.
State writes use a same-directory 0600 temporary file, file fsync, atomic
rename, and directory fsync where supported. Locks contain a token, PID, and
timestamp; recovery requires an unchanged token, a dead local owner, and an
expired age.

A central bootstrap runs before MCP service startup and before every mutating
CLI operation. It holds a distinct global mutation lock across state intent,
the complete Git effect, and the terminal receipt. A lock may be recovered only
after its token is stable and its owner PID is dead; age alone never permits
recovery. Bootstrap inventories and resumes every recoverable `PENDING` action.
An unprovable intent or any `NEEDS_ATTENTION` inventory item blocks ordinary
mutation while leaving read, doctor, reconciliation, rollback, and confirmed
CLI purge available.

There is one state contract and no migration path. A symlink, corrupt JSON, or
state outside that contract fails closed without deletion. Bootstrap may remove
only recognized dead temporary files created by atomic state writes. Worktrees,
reports, and recovery proofs are never reset as a side effect of loading state.

Reconciliation compares desired missions, Git worktree registrations, physical
directories, cleanliness, base revisions, locks, and disk budget. It removes
only clean worktrees belonging to terminal missions and prunes only metadata
whose path is truly absent. Dirty, unknown, symlinked, or ambiguous targets are
classified `NEEDS_ATTENTION` and are not recursively erased.

Allocation, reconciliation, rollback, and purge entries retain an explicit
categorical outcome, including `ROLLED_BACK` and `PURGED`, independently from
the mission allocation status.

Rollback first captures bounded Git state, file inventory, digest, and a binary
restorable patch under `.ctxroute/recovery/`. Its header has one exact closed
shape; unknown fields or malformed Git and path evidence invalidate recovery.
Failed or oversized capture blocks removal. A CLI-only purge is the sole no-proof path and requires orchestrator
authority, unique operation ID, reason, exact mission confirmation, and a
canonical target within the managed root.

## Consequences

Crashes converge by replaying `PENDING` intent. Git worktrees provide checkout
isolation, not hostile-process containment, and ambiguous local data always
requires operator attention.
