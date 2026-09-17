---
scope:
  - scripts/orchestrator-core.mjs
  - scripts/orchestrator-service.mjs
  - scripts/worktree-manager.mjs
  - scripts/git-command-policy.mjs
  - .project/schemas/orchestrator/**
  - tests/orchestrator-*.test.mjs
  - tests/orchestration-policy.test.mjs
review: on-change
revised: true
supersedes:
  - ADR-0025-recoverable-worktrees.md
contracts:
  - docs/orchestration.md
  - docs/orchestration-verification.md
---
# ADR-0089 — Single repository mutation authority and outcome proof

- Status: accepted
- Date: 2026-09-17

## Decision

`repositoryMutationLock` is the only authority for shared Git effects. Worktree
allocation/removal, orchestrator commits, integration, rollback, reference
archive/purge, and recovery execute while that portable lock is held. Workers
have a deterministic Git allowlist and cannot commit, fetch, update refs, or
otherwise mutate repository state. Remote operations are never granted by a
workflow.

The orchestrator materializes worker changes as a commit, then integrates that
exact commit into the primary checkout under the same authority. Integration
records the source and resulting primary OIDs. No successful worker claim is a
substitute for this Git evidence.

Completion is a verified effect, not a status flag. Read-only outcomes compare
the final repository snapshot with the goal baseline. Mutation outcomes require
the recorded integrated commit to be reachable from the primary checkout.
Recovery outcomes require bounded backup references plus a verified final Git
inventory. Experiments additionally require a consumed promotion decision.

Recovery inventories managed and unmanaged worktrees, interrupted Git
operations, divergent branches, and unreachable commits. Age is descriptive
only. Dirty removal first captures the bounded binary patch proof. Destructive
purge, reference deletion, or recovery archive requires an explicit compatible
`DecisionReceipt`.

## Consequences

All shared Git races have one serialization point and one audit trail. SHA-256
digests provide integrity and correlation only; they are never described as a
human signature or non-repudiation proof.
