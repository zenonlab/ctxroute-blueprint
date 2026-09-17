---
scope:
  - .codex/hooks/**
  - .codex/hooks.json
  - .claude/settings.json
  - scripts/orchestrator-policy-snapshot.mjs
  - scripts/hook-performance.mjs
  - tests/hooks.test.mjs
  - tests/orchestration-policy.test.mjs
review: on-change
revised: true
contracts:
  - docs/orchestration.md
  - docs/orchestration-verification.md
---
# ADR-0090 — Atomic hook policy and host-specific adapters

- Status: accepted
- Date: 2026-09-17

## Decision

Each lifecycle event starts one Node process. Local handlers are imported and
invoked in that process; the dispatcher does not spawn a Node subprocess per
handler. Long CRG and maintenance work remains on the declared asynchronous
lane. Read-only tools are filtered before filesystem, ADR, or Git scans.

Mutation hooks consume an atomic, closed `ResolvedExecutionPolicy` snapshot of
less than 16 KiB. The snapshot envelope has its own SHA-256 integrity digest,
and the policy digest is independently recomputed. A failed read uses the last
valid in-process snapshot; otherwise the hook reconstructs canonical
`SWARM + STANDARD` from validated configuration. If reconstruction cannot be
verified, only mutation is blocked with mode, workflow, stage, policy digest,
categorical cause, invariant, and a concrete MCP/CLI recovery command.

The policy engine returns a host-neutral decision. The Codex and Claude
adapters alone produce host envelopes. Claude failure uses stderr plus exit 2
with no JSON; a policy denial uses the supported JSON denial envelope with exit
0. `Stop` is tested separately and never creates an automatic continuation.

The performance gate measures at least ten samples per host. Mutation
`PreToolUse` p95 is at most 250 ms, `PostToolUse` p95 at most 500 ms, and
read-only events p95 at most 100 ms. Explicit asynchronous validations are not
charged to these synchronous budgets.

## Consequences

Hook behavior is deterministic across hosts without conflating transport
contracts. Snapshot corruption cannot silently grant write authority, and hook
latency cannot regress behind nested interpreter startup.
