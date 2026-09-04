---
scope:
  - scripts/progress-core.mjs
  - scripts/progress-mcp.mjs
  - scripts/progress-dashboard.mjs
  - scripts/progress-dashboard.html
  - scripts/progress-dashboard-client.js
  - scripts/progress-dashboard-manager.mjs
  - .project/progress.json
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
`SubagentStart` automatically claims only `automatic` goals and injects the
complete ticket plus a required final `PROGRESS_RESULT` JSON footer.
`SubagentStop` accepts only `DONE` or `BLOCKED` with non-empty bounded evidence
on the last non-empty line outside Markdown fences. Invalid output atomically
releases that agent's claim to `TODO`; `SessionEnd` releases remaining
`IN_PROGRESS` claims matching only its opaque session prefix. These hooks fail
open with bounded diagnostics when Progress is busy or unavailable.
When every unfinished step is `BLOCKED`, Stop emits that incomplete handoff
without blocking termination in either mode. It does not offer autonomous mode
for work already recorded as blocked.
`BLOCKED` does not itself prove an external dependency. Stop labels a blocker
external only when every unfinished step has short evidence prefixed with
`external:`. It selects runnable `TODO` or `IN_PROGRESS` work before older
blocked goals, preventing a stale handoff from starving automatic execution.

The mode changes progression policy only. It does not change Codex or Claude
permissions, tool access, or technical safety controls.
Codex and Claude provide the parent `session_id`, subagent `agent_id`, and
`last_assistant_message` needed by this contract in their official hook
schemas: [Codex hooks](https://developers.openai.com/codex/hooks/) and
[Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks).
MCP callers must classify a manual transition as `visual-review` or
`important-decision`; the shared core persists that value as `manualReason`
and rejects a new manual transition or plan without it. Returning to automatic
clears the reason. Completed legacy manual goals retain `manualReason: null`
because their history cannot be reconstructed. The dashboard presents both
modes in a compact select with an accessible hover/focus explanation, then asks
for one of the two reasons before activating manual mode. The shared core reads
legacy `autonomous` as `automatic` and `collaborative` as `manual`. On the first Stop for a Codex
session with unfinished work, the hook publishes the authenticated local URL.
A marker keyed by a hash of the official `session_id` suppresses repeats while
allowing a replacement instance to be announced after the prior server dies.
