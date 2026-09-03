---
match: ["src/", "app/", "lib/", "components/", "pages/", "scripts/", "packages/", "tests/", "docs/", ".project/", ".githooks/", ".codex/", ".github/", "package.json", "AGENTS.md", "CLAUDE.md"]
mode: once
---

# Agent progress checklist

CTXRoute `match` entries are path substrings, not glob expressions. The
frontmatter therefore names repository roots directly so this guidance reaches
significant product, test, hook, documentation, and configuration changes.

Read `.project/progress.json` before a significant change and verify that the
change belongs to an existing goal. If it is not covered, add a short step to
a structured plan. Validate it before modifying files. Materialize a faithful
breakdown of an explicit request immediately; ask first only if it adds an
important product, architecture, or design choice the user has not made.

Never edit `.project/progress.json` or `docs/progress.md` directly. Never mark
an item done without a short evidence reference. Do not create hooks,
permissions, global rules, or `AGENTS.md` automatically. SQLite remains only
for recurring-problem memory. PostToolUse may report missing checklist coverage
but must not write the checklist.
New goals use `automatic`: execute and verify the request through `DONE` or a
real external blocker. Use `manual` only for visual review or an important
undecided product/change/design choice. Routine implementation stays automatic.
Require Archify only for a material boundary, public contract, dependency, or
cross-component flow change—not merely because feature code was added.
