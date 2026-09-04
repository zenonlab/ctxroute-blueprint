---
scope:
  - .codex/agents/
  - .claude/agents/
  - .codex/hooks.json
  - .claude/settings.json
  - .github/workflows/
  - package.json
  - scripts/progress-dashboard-manager.mjs
  - scripts/progress-cli.mjs
  - scripts/blueprint-sync.mjs
review: on-change
revised: true
---
# ADR-0023 — Operable Progress workers and resilient validation

## Decision

The blueprint ships an explicit `progress-worker` definition for both Codex and
Claude. Lifecycle configuration validates those definitions and limits both
subagent hooks to that type. Ordinary subagents never pay Progress lifecycle
costs.

Post-tool governance runs only after structured editing tools. Shell commands
remain covered before execution by the architecture policy and by repository
validation, without spawning the complete post-write pipeline after read-only
commands.

The local dashboard remains voluntary and durable, but the CLI exposes an
explicit, idempotent close operation. Tests must isolate CTXRoute state and must
terminate every detached dashboard they create even when an assertion fails.

Derived repositories can inspect, drift-check, or apply a conservative control-plane update
from a trusted blueprint checkout. The synchronizer has an explicit allowlist,
defaults to a dry run, refuses dirty targets, creates a recoverable backup, and
never overwrites project decisions, Progress data, product documentation, or
source code. A versioned marker travels with that allowlist so automation can
fail visibly when a derived control plane is stale without rewriting it.

Cross-platform CI runs the complete repository gate on Linux and bounded
platform smoke checks on macOS and Windows. Dependency audit runs once in a
dedicated Linux job through a bounded wrapper; only a decoded high or critical
vulnerability result is a quality failure, while timeout, registry, or malformed
response failure produces a visible non-blocking infrastructure warning. CRG
high risk requests review but does not assert that
correctness failed.

## Consequences

Automatic Progress work is reachable through real harness agent types, routine
tool calls create fewer processes, detached resources have an operator cleanup
path, and external service instability no longer hides local verification.
Control-plane updates remain an explicit operator action because silently
rewriting an already-derived project would destroy local policy.
