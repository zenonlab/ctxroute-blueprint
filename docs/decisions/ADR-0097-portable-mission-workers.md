---
scope:
  - scripts/orchestrator-*.mjs
  - .project/schemas/orchestrator/
  - .codex/hooks/
  - docs/architecture/src/blueprint.architecture.json
review: on-change
contracts:
  - docs/orchestration.md
  - docs/orchestration-verification.md
---
# ADR-0097 — Portable mission workers

- Status: accepted
- Date: 2026-09-24

## Decision

CTXRoute alone schedules durable missions. Preparing a mission allocates an
isolated worktree but never launches a worker. A separate local runner selects
ready, non-overlapping missions within the configured parallel worktree limit.
Codex, Claude Code, and OpenCode implement the same MissionView-to-WorkerReport
adapter contract. Native subagent delegation is disabled for mission workers;
it remains available outside the orchestrator.

The primary Git checkout owns policy and state. A worker receives its primary
root and mission identity, and the common Git directory is checked before
launch or mutation. Hooks use the primary root for durable policy and the
assigned worktree for file controls. No state is copied into worktrees.

Attempts persist only an identifier, adapter, supervisor PID, timestamps,
terminal state, and bounded cause. A dead supervisor is reconciled to
`BLOCKED` without deleting its worktree. The orchestrator validates the
worker's report against the actual diff and declared commands, then alone
commits and serially integrates into a clean primary checkout.

## Consequences

The CLIs may be replaced without changing mission contracts. A prepared
mission is visibly distinct from a running attempt. Interrupted and invalid
attempts retain evidence for explicit recovery instead of silently rerunning.
