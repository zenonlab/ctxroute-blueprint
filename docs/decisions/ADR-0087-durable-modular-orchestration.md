---
scope:
  - .project/schemas/orchestrator/
  - .project/orchestrator-config.json
  - .agents/skills/
  - scripts/orchestration-policy-core.mjs
  - scripts/orchestrator-*.mjs
  - scripts/git-command-policy.mjs
  - .codex/hooks/
review: on-change
revised: true
contracts:
  - docs/orchestration.md
---
# ADR-0087 — Durable modular orchestration

- Status: accepted
- Date: 2026-09-17

## Decision

Separate persistent operating mode, goal workflow, and per-stage strategy. The
canonical default is `SWARM + STANDARD`; `AUTO`, `SOLO`, `GUARDED`, and
`DIRECT` provide progressively narrower coordination. A pure policy resolver
merges permissions by intersection, requirements by union, floors by maximum,
and write/parallel access by the most restrictive constraint. It returns a
closed resolution status and a SHA-256 integrity/correlation digest.

Goals freeze their resolved policy digest. Global mode changes affect new
goals only; `goal.policy.rebase` is limited to safe checkpoints and cannot
weaken repository-mutation serialization. Human pauses persist only closed
decision/checkpoint contracts and artifact references. They never persist
model memory or conversation history.

`RESEARCH` and `AUDIT` are mechanically read-only. `EXPERIMENT` ends at
`READY_FOR_PROMOTION` and requires an explicit promotion decision before
integration. `RECOVERY` may inventory all Git state, but destructive cleanup
continues to require an explicit receipt. Goal completion requires an outcome
receipt appropriate to its declared effect.

The existing portable global lock becomes the named repository mutation
authority for every shared Git effect. Workers may execute only deterministically
classified read-only Git commands. A digest is not described as a signature or
proof of human identity.

## Compatibility and host behavior

Historical `SWARM_ON`, `SWARM_OFF`, `CTXROUTE_SWARM_MODE`, `defaultMode`, and
`mode.set` values remain readable. New writes use canonical modes. Hook policy
decisions are host-neutral internally; Codex and Claude adapters produce their
own envelopes, never JSON combined with Claude `exit 2` blocking semantics.

## Consequences

Policy resolution can be property-tested without disk, network, Git, or
environment access. Skills declare stages, capabilities, access, tools, and
independence instead of enumerating operating modes. The control plane gains
durable inter-session decisions without treating raw model state as authority.
