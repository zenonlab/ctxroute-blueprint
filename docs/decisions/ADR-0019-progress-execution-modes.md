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
permissions, tool access, or technical safety controls.
The dashboard presents both values in a compact select with an accessible
hover/focus explanation. It requires a custom-dialog confirmation for either
transition, restores the prior selection when cancelled, and passes
`userConfirmed` through the shared core. On the first Stop for a Codex
session with unfinished work, the hook publishes the authenticated local URL.
A marker keyed by a hash of the official `session_id` suppresses repeats while
allowing a replacement instance to be announced after the prior server dies.
