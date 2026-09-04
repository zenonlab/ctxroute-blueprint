---
match: ["src/", "app/", "lib/", "components/", "pages/", "scripts/", "packages/", "tests/", "docs/", ".project/", ".githooks/", ".codex/", ".github/", "package.json", "AGENTS.md", "CLAUDE.md"]
mode: once
---

# Agent progress checklist

Progress is optional ordered memory, never a prerequisite or permission gate.
Skip it for small or single-agent work. For substantial work, keep 2–6 outcome
milestones; never mirror files, commands, commits, or routine edits. Only truly
independent parallel work is claimable by a `progress-worker`.

MCP and `progress:*` CLI are equivalent; continue safely if either is unavailable.
Only SubagentStart/SubagentStop/SessionEnd automate worker claims. PostToolUse
never changes Progress. Manual means an undecided visual review or important
decision—not another `go`. Resume context is advisory. Read full Progress only
when details or a mutation are needed, and require Archify only for a material
boundary, contract, dependency, or cross-component flow.
