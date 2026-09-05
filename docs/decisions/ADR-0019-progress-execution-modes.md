---
scope:
  - scripts/progress-core.mjs
  - scripts/progress-mcp.mjs
  - scripts/progress-dashboard.mjs
  - scripts/progress-dashboard-manager.mjs
  - .codex/hooks/stop-review.mjs
  - .claude/hooks/docs/progress-guidance.md
review: on-change
revised: true
---
# ADR-0019 — Collaborative and autonomous progress execution

## Decision

Progress has exactly two per-goal modes: `collaborative` by default and
`autonomous` only after explicit user confirmation. Collaborative execution
preserves user decisions that materially change the result and provides a
bounded handoff. Autonomous execution chains approved steps, searches for
solutions, verifies acceptance criteria, and records evidence before returning
control; a genuine external blocker is the only incomplete handoff.
When every unfinished step is `BLOCKED`, Stop emits that incomplete handoff
without blocking termination in either mode. It does not offer autonomous mode
for work already recorded as blocked.

The mode changes progression policy only. It does not change Codex or Claude
tool access or technical safety controls. Project authorization remains bounded:
once the user confirms autonomous mode for a materialized goal, the agent may
complete its validated steps and each step's listed reversible repository
mutations, validation, Progress update, and verified commit without another
`go`. Actions reserved by ADR-0022 still require separate approval.

`BLOCKED` alone does not prove an external dependency. A genuine external
blocker carries at least one short evidence entry prefixed with `external:` on
every unfinished blocked step. Stop prioritizes runnable goals over blocked
goals so an old handoff cannot starve later autonomous work.
The dashboard presents both values in a compact select with an accessible
hover/focus explanation. It requires a custom-dialog confirmation for either
transition, restores the prior selection when cancelled, and passes
`userConfirmed` through the shared core. On the first Stop for a Codex
session with unfinished work, the hook publishes the authenticated local URL.
A marker keyed by a hash of the official `session_id` suppresses repeats while
allowing a replacement instance to be announced after the prior server dies.
