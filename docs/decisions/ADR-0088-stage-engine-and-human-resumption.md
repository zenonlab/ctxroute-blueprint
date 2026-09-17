---
scope:
  - .project/schemas/orchestrator/**
  - scripts/orchestration-policy-core.mjs
  - scripts/orchestrator-core.mjs
  - scripts/orchestrator-service.mjs
  - tests/orchestration-policy.test.mjs
  - tests/orchestrator-*.test.mjs
review: on-change
revised: true
contracts:
  - docs/orchestration.md
  - docs/orchestration-verification.md
---
# ADR-0088 — Declarative stage engine and human resumption

- Status: accepted
- Date: 2026-09-17

## Decision

Every durable goal stores the complete resolved policy that created it, not
only a digest. The digest is recomputed at every trust boundary. The current
stage is an index into that frozen plan; a stage may advance exactly once and
only from the strategy and access declared by that plan.

Before a goal enters `WAITING_FOR_USER_DECISION`, the same atomic transaction
stores a closed `StageCheckpoint` and `DecisionRequest`. A checkpoint contains
identifiers, completed receipt identifiers, artifact references, and the next
stage only. It cannot contain prompts, conversation history, model memory, raw
tool output, or environment state. Resolution checks the frozen digest and the
checkpoint, consumes one pending request exactly once, and resumes the recorded
stage without replaying accepted stages.

Policy rebasing is allowed only at a checkpoint with no running mission. It
must preserve every mechanical floor from the frozen policy: serialized Git
mutation, read-only workflow constraints, required isolation, risk/model
floors, and critical independent audit. Rebase records an audit event and never
silently rewrites completed checkpoints.

`EXPERIMENT` produces an `ExperimentReceipt`, retains its worktree, and stops at
`READY_FOR_PROMOTION`. Promotion consumes an explicit compatible decision
receipt and moves to integration; rejection never integrates. Research and
audit plans remain read-only at both policy and mission boundaries.

## Consequences

Session death cannot erase or duplicate a human decision. Stage progression is
replay-safe and independently testable. A goal cannot infer progress from a
model transcript or from the existence of files alone.
