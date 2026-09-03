---
scope:
  - scripts/progress-core.mjs
  - scripts/progress-cli.mjs
  - scripts/progress-mcp.mjs
  - scripts/progress-dashboard.mjs
  - scripts/progress-dashboard-app.mjs
  - scripts/progress-dashboard-manager.mjs
  - .project/progress.json
  - docs/progress.md
  - .claude/hooks/docs/progress-guidance.md
  - AGENTS.md
  - scripts/validate-mcp-installation.mjs
  - tests/mcp-stdio.test.mjs
  - package.json
  - package-lock.json
review: on-change
revised: true
---

# ADR-0014 — Asynchronous agent ticket coordination

## Context

Agents need a small durable representation of a validated plan that can be
read by CLI, MCP, hooks, and CTXRoute without turning Plan mode into a writer.

## Decision

Use `.project/progress.json` as the sole source of truth and generate the short
`docs/progress.md` view from it. A shared Node.js `progress-core` validates
bounded plans and writes both files atomically after an authorized request.
The `approved: true` field is a write flag rather than a second conversational
approval when the plan faithfully restates that request. It persists
`executionMode` per goal, with `automatic` as the default. Materialization freezes goal and step identifiers, not the
displayed content or step structure. Goal titles, step titles, criteria, files,
commands, evidence, additions, deletions, and exact ordering are mutable only
through visible, validated, revision-checked user actions backed by the shared
core. Every mutation derives goal status, regenerates the Markdown view, and
keeps `DONE` conditional on short evidence. The CLI, MCP, and Stop hook
call the same functions. Evidence is a short reference, never raw logs or
conversation text. SQLite remains problem-memory storage only.

`AGENTS.md` states the Progress lifecycle directly so it does not depend on a
matching tool call for discovery. CTXRoute reinforces that lifecycle on all
significant repository roots using its path-substring matching semantics. The
CLI remains a fallback when the client did not load the project-scoped MCP.
The local dashboard is another adapter over this core and every web mutation
carries an optimistic revision. Existing identifiers are never rewritten and
the final step of a goal cannot be deleted.

Progress is optional for small or single-agent work. During substantial
parallel work, each step acts as a ticket: `progress_claim_ticket` atomically
assigns one `TODO` step to an agent and moves it to `IN_PROGRESS`. Agent result
reporting rejects unclaimed tickets. The agent
does not mirror intermediate activity and reports only its final result. Every
mutation shares a bounded, owner-identified filesystem lock; stale recovery is
serialized before a replacement owner is installed. MCP and fallback CLI
mutation responses contain only acknowledgements, while status and next-step
reads omit full ticket bodies.
A busy or unavailable Progress service does not block safe work.

## Consequences

Validation is read-only and materialization is a separate operation. The contract
supports up to 20 goals, 30 steps per goal, and 10 evidence references per
step, with a 64 KiB JSON limit. No hook edits the checklist automatically.
Agents must start from the repository root and restart after MCP manifest
changes because the client owns project-scoped server discovery and transport.
The dashboard exposes completed goals without deleting them. A stale mutation
reloads server state while preserving matching local drafts instead of silently
overwriting either version.
