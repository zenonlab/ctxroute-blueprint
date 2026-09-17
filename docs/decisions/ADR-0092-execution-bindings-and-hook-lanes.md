---
scope:
  - .project/schemas/orchestrator/**
  - scripts/orchestrator-*.mjs
  - scripts/hook-performance.mjs
  - .codex/hooks/**
  - .codex/hooks.json
  - .claude/settings.json
review: on-change
supersedes:
  - ADR-0002-ctxroute-integration.md
  - ADR-0018-official-code-review-graph.md
  - ADR-0090-atomic-hook-policy-and-host-adapters.md
contracts:
  - docs/orchestration.md
  - docs/orchestration-verification.md
---
# ADR-0092 — Durable execution bindings and honest hook lanes

- Status: accepted
- Date: 2026-09-17

## Decision

Each worker mutation resolves a closed `ExecutionBinding` from the atomic
orchestrator state using `CTXROUTE_MISSION_ID`. The binding contains goal and
optional mission/session identity, policy snapshot path and digest, workflow,
stage, strategy, access, and state revision. Environment values may confirm a
binding but never replace it. Missing, stale, unknown-stage, or contradictory
bindings block mutation. Goal-free work alone may use the global snapshot.

`MissionView` is the sole worker projection and includes structured
`validations`, the binding fields, worktree, acceptance criteria, skill, and
reinforcements. It excludes conversation, reasoning, history, and raw
environment state.

Every lifecycle event starts one Node process per declared lane and imports
its handlers directly. The synchronous lane contains policy and architecture
mutation gates plus bounded Sensor/audit handlers. The maintenance lane runs
bounded problem observation and coalesced CRG updates through honest host
`async` entries. Archify preview remains manual until it has a lifecycle that
can own and stop its process. No handler launches a nested Node dispatcher.

Handlers declare `critical-mutation-gate`, `advisory`, or `maintenance`.
Mutation-gate failure blocks through the host adapter. PostToolUse Sensor and
audit remain visible and fail-open because the edit already occurred.
Maintenance is silent and fail-open. Total merged system messages and context
are bounded. Codex and Claude keep separate output adapters and never combine
JSON with an infrastructure exit code 2.

The performance gate measures synchronous p95 separately and executes the
maintenance plan. Coverage is computed from observed plans and process
results; it is never a hard-coded success.

## Consequences

A worker cannot mutate under another goal's policy or a read-only stage.
Declared lanes correspond to executable host entries, while manual tools are
listed as manual rather than presented as asynchronous automation.
