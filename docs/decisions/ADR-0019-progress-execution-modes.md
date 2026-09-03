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
# ADR-0019 — Automatic execution with targeted manual pauses

## Decision

Progress has exactly two per-goal modes: `automatic` by default and `manual`
only for a visual review or a consequential product/change/design decision not
already made by the user. Automatic execution chains requested steps, searches
for solutions, verifies acceptance criteria, and records evidence before
returning control; a genuine external blocker is the only incomplete handoff.
Routine feature implementation, tests, documentation, and decisions already
present in the request never justify a manual pause.
Automatic Stop output is advisory and never returns a blocking decision;
parallel agents may own unfinished tickets independently. Manual mode remains
the only progression pause.
When every unfinished step is `BLOCKED`, Stop emits that incomplete handoff
without blocking termination in either mode. It does not offer autonomous mode
for work already recorded as blocked.

The mode changes progression policy only. It does not change Codex or Claude
permissions, tool access, or technical safety controls.
The dashboard presents both values in a compact select with an accessible
hover/focus explanation and saves transitions directly. The shared core reads
legacy `autonomous` as `automatic` and `collaborative` as `manual`. On the first Stop for a Codex
session with unfinished work, the hook publishes the authenticated local URL.
A marker keyed by a hash of the official `session_id` suppresses repeats while
allowing a replacement instance to be announced after the prior server dies.
