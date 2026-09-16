---
scope:
  - .project/orchestrator-config.json
  - .project/schemas/orchestrator/**
  - docs/architecture/src/blueprint.architecture.json
  - docs/architecture/src/traffic.dataflow.json
  - scripts/orchestrator-*.mjs
  - tests/orchestrator-*.test.mjs
review: on-change
revised: true
contracts:
  - .project/schemas/orchestrator/model-descriptor.schema.json
  - .project/schemas/orchestrator/task-assessment.schema.json
  - .project/schemas/orchestrator/routing-decision.schema.json
---
# ADR-0029 — Adaptive provider-neutral model routing

- Status: accepted
- Date: 2026-09-16

## Decision

Route every adaptive orchestrator phase through a pure, provider-neutral core.
The core receives only closed model descriptors, a bounded task assessment,
phase policy, consumption policy, and historical aggregates. It never invokes a
CLI, reads credentials, names a preferred provider, or embeds evolving model
identifiers.

Execution levels are `L0` deterministic, `L1` fast, `L2` balanced, `L3`
advanced, and `L4` critical. Mechanical facts establish a non-decreasing risk
floor. Planner advice may raise this floor but cannot lower it. The router
eliminates incompatible candidates before scoring and selects the lowest
qualified level deterministically. Every decision records its inputs, cascade,
selected candidate, and rejected alternatives.

Configuration resolves in this order: safety floor, explicit goal constraint,
mission override, skill policy, phase profile, user preset, project policy,
then framework default. Restrictions intersect; preferences use the highest
applicable priority. Invalid values fail explicitly. `economy`, `balanced`,
`quality`, and `custom` alter cost, latency, parallelism, and audit preferences
but never reduce a safety floor.

Codex, Claude, Gemini, and the test-only fixture implement the same adapter
contract. Executables remain a closed allowlist. Commands are argument arrays,
never shell strings. Read phases use read-only tools and write phases remain in
the mission worktree. Bypass flags are forbidden. A missing provider, quota,
authentication failure, timeout, unknown model, and invalid structured output
remain distinct categorical failures.

Escalation is monotone. A provider-only failure first tries a declared fallback
at the same level; capability, validation, scope, confidence, or repeated repair
failures move upward. All attempts consume the goal budget. Unknown monetary
cost stays unknown; the orchestrator never invents a currency estimate.
Critical work requires a different provider family for the final audit and is
blocked when that independence is unavailable.

Legacy configuration containing only `workerRuntime` retains the former global
runtime behavior. A configuration with `modelRouting.mode` set to `adaptive`
uses the new route. Existing state remains readable through optional adaptive
fields; new adaptive goals persist their assessment, decisions, receipts,
escalations, and consumption totals.

## Consequences

Model aliases and capability claims are configuration and probe data, not core
truth. `explain-route` executes the exact pure decision function used for
dispatch. Large repetitive audits may shard across small qualified models and
use a higher synthesis tier only when risk demands it.
