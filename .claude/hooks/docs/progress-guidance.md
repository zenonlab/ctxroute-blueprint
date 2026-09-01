---
match: ["scripts/**", "packages/**", ".project/progress.json", "docs/progress.md", "package.json"]
---

# Agent progress checklist

Read `.project/progress.json` before a significant change and verify that the
change belongs to an existing goal. If it is not covered, add a short step to
a structured plan. Produce the plan before modifying files, then call
`progress_validate_plan` (or `npm run progress:validate`) first. Only after
explicit approval may the agent call `progress_approve_plan` (or
`npm run progress:approve`); `approved: true` is mandatory.

Never edit `.project/progress.json` or `docs/progress.md` directly. Never mark
an item done without a short evidence reference. Do not create hooks,
permissions, global rules, or `AGENTS.md` automatically. SQLite remains only
for recurring-problem memory. PostToolUse may report missing checklist coverage
but must not write the checklist.
Progress usage: treat the approved checklist as the source of truth. The mode
is `collaborative` unless the user explicitly asks to activate `autonomous`
and confirms it. In collaborative mode, update each step and show up to three
next steps. In autonomous mode, seek solutions yourself, execute all approved
steps, verify every acceptance criterion, attach short evidence, and finish
only when the goal is `DONE` or a real external blocker is documented.
