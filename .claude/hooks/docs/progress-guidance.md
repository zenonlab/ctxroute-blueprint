---
match: ["src/", "app/", "lib/", "components/", "pages/", "scripts/", "packages/", "tests/", "docs/", ".project/", ".githooks/", ".codex/", ".github/", "package.json", "AGENTS.md", "CLAUDE.md"]
mode: once
---

# Agent progress checklist

CTXRoute `match` entries are path substrings, not glob expressions. The
frontmatter therefore names repository roots directly so this guidance reaches
significant product, test, hook, documentation, and configuration changes.

Progress is optional asynchronous coordination, not a prerequisite for edits.
Skip it for small or single-agent work. For substantial parallel work, create
independent tickets once; each agent atomically claims one, works without
intermediate Progress writes, then reports `DONE` or `BLOCKED` with evidence.
If the MCP is busy or unavailable, continue safe work and reconcile afterward.

Never edit `.project/progress.json` or `docs/progress.md` directly. Never mark
an item done without a short evidence reference. Do not create hooks,
permissions, global rules, or `AGENTS.md` automatically. SQLite remains only
for recurring-problem memory. PostToolUse may report missing checklist coverage
but must not write the checklist.
New goals use `automatic`, which never blocks Stop. Use `manual` only with
reason `visual-review` or `important-decision` for the matching undecided choice.
Require Archify only for a material boundary, public contract, dependency, or
cross-component flow change—not merely because feature code was added.
