---
scope:
  - scripts/progress-core.mjs
  - scripts/progress-mcp.mjs
  - .codex/hooks/stop-review.mjs
  - .claude/hooks/docs/progress-guidance.md
review: on-change
revised: true
superseded-by: ADR-0022-universal-ctxroute-orchestration.md
---
# Archived ADR-0019 — Collaborative and autonomous progress execution

- Status: superseded by `ADR-0022-universal-ctxroute-orchestration.md`

This file is historical evidence only and is outside the active ADR corpus.

## Decision

Progress has exactly two per-goal modes: `collaborative` by default and
`autonomous` only after explicit user confirmation. Collaborative execution
preserves user decisions that materially change the result and provides a
bounded handoff. Autonomous execution chains approved steps, searches for
solutions, verifies acceptance criteria, and records evidence before returning
control; a genuine external blocker is the only incomplete handoff.

The mode changes progression policy only. It does not change Codex or Claude
permissions, tool access, or technical safety controls.

This decision is superseded by ADR-0022 and its universal `SWARM_ON` /
`SWARM_OFF` execution modes.
