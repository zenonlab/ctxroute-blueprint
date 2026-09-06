---
scope:
  - scripts/orchestrator-*.mjs
  - scripts/worktree-manager.mjs
  - .ctxroute/orchestrator/events.jsonl
  - .project/schemas/orchestrator/decision-event-v*.schema.json
  - tests/orchestrator-*.test.mjs
review: on-change
revised: true
contracts:
  - .project/schemas/orchestrator/decision-event-v2.schema.json
---
# ADR-0026 — Bounded local decision telemetry

- Status: accepted
- Date: 2026-09-06

## Decision

The orchestrator reads historical `DecisionEventV1` records and emits only
schema-validated `DecisionEventV2` JSON lines to a 0600
local file, capped at 1 MiB plus one rotation. A monotone sequence links events
to state revisions and categorical transitions. Events may contain operation,
entity, mode source, skill version, validation timing and exit code, Git OIDs,
outcome, bounded cause codes, `policy_id`, `schema_id`, an expurgated JSON schema
path/keyword, and an evidence digest. There is one event per transition and one
per validation result.

Append and rotation share a tokenized lock. Rotation atomically renames the
active file and never relies on overwriting an existing destination, preserving
Windows compatibility and at most one completed rotation.

Events never contain prompts, conversation, reasoning, environment variables,
raw stdout or stderr, file content, or credentials. Telemetry failure is
reported but cannot invalidate or roll back authoritative transactional state.

## Consequences

Reset, transaction, replay, conflict, transition, validation, audit, skill
registration, reconciliation, rollback, purge, and blocked outcomes are locally
observable without turning the event log into another state store.
