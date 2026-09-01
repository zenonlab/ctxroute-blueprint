---
scope:
  - scripts/progress-core.mjs
  - scripts/progress-cli.mjs
  - scripts/progress-mcp.mjs
  - .project/progress.json
  - docs/progress.md
  - .claude/hooks/docs/progress-guidance.md
  - package.json
  - package-lock.json
review: on-change
revised: true
---

# ADR-0014 — Explicit agent progress checklist

## Context

Agents need a small durable representation of an approved plan that can be
read by CLI, MCP, hooks, and CTXRoute without turning Plan mode into a writer.

## Decision

Use `.project/progress.json` as the sole source of truth and generate the short
`docs/progress.md` view from it. A shared Node.js `progress-core` validates
bounded plans and writes both files atomically only after explicit approval.
It persists `executionMode` and `modeOffered` per goal, with `collaborative` as
the migration/default mode. Mutable step status is updated idempotently through
the same core and `DONE` requires short evidence. The CLI, MCP, and Stop hook
call the same functions. Evidence is a short reference, never raw logs or
conversation text. SQLite remains problem-memory storage only.

## Consequences

Validation is read-only and approval is a separate operation. The contract
supports up to 20 goals, 30 steps per goal, and 10 evidence references per
step, with a 64 KiB JSON limit. No hook edits the checklist automatically.
