---
match: ["src/", "app/", "lib/", "components/", "pages/", "scripts/", "packages/", "tests/", "docs/", ".project/", ".githooks/", ".codex/", ".github/", "package.json", "AGENTS.md", "CLAUDE.md"]
mode: once
---

# Agent progress checklist

Progress is optional ordered memory, not a prerequisite or taskmaster. Skip it
for small or single-agent work. Use 2–6 outcome milestones in declared order;
do not mirror files, commands, commits, or routine edits. Only independent
parallel work gets `claimable: true`. Claim and report once, after verification.
If MCP is unavailable, continue safe work and use the matching `progress:*` CLI.
Full JSON is voluntary via `ctxroute://progress/full` or the diagnostic CLI.

Never edit generated Progress files directly or finish without short evidence.
Only a `progress-worker` auto-claims on `SubagentStart`; its structured footer
updates the ticket on `SubagentStop`, and `SessionEnd` releases its claims.
Main agents may use MCP or CLI. `PostToolUse` never changes Progress; automatic
Stop is silent. Manual mode is reserved for an undecided visual review or
important decision. `BLOCKED` is external only with `external:` evidence for a
real dependency—missing approval is not external. Require Archify only for a
material boundary, public contract, dependency, or cross-component flow change.
