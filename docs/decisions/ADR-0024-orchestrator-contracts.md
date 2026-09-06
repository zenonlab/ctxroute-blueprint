---
scope:
  - .project/orchestrator-config.json
  - .project/project-config.json
  - .project/schemas/orchestrator/**
  - docs/document-contracts.json
  - package.json
  - package-lock.json
  - scripts/orchestrator-*.mjs
  - scripts/worktree-manager.mjs
  - tests/orchestrator-*.test.mjs
review: on-change
revised: true
contracts:
  - docs/document-contracts.json
  - package.json
---
# ADR-0024 — Canonical orchestrator contracts

- Status: accepted
- Date: 2026-09-06

## Decision

JSON Schema draft 2020-12 is the canonical contract for orchestrator
configuration, state, transactions, mission request/record/view projections,
worker reports, audit reports, validation receipts, worktree operations, and
decision events. Ajv 8.20.0 compiles the registered schemas once in strict mode.
Core, service, stdio MCP, CLI, and tests use the same adapter.

Persisted orchestrator state uses one unversioned current contract. Produced
objects have stable unversioned `$id` values, explicit required properties, closed enums,
bounded strings and arrays, safe repository-relative paths, and
`unevaluatedProperties: false`. Conversation, prompts, reasoning, raw
environment, and raw subprocess output are outside every contract. Imperative
checks remain only for runtime facts JSON Schema cannot prove: Git existence
and scope, role authority, canonical filesystem containment, and contextual
secret detection.

Mission requests, orchestrator-owned records, and positive worker views are
different contracts. Validation commands are structured executable/argument
records and always run without a shell. A worker report only declares results;
the orchestrator replays every required validation and only its bounded receipt
can complete the mission.

The release gate runs contract compilation, targeted skill validations, and
the bounded lifecycle performance harness as first-class package commands.

Transactions persist a SHA-256 digest of the canonical action and complete
payload, excluding only `expected_revision`. An identical replay may converge
after its expected revision is stale. Reuse of an operation identifier with any
payload difference is rejected before physical effects.

## Consequences

Contract drift becomes a deterministic local failure. There is no compatibility
layer or version negotiation, and `worker-report` is the only worker response
format accepted by missions.
