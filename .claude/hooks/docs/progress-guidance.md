---
match: ["src/", "app/", "lib/", "components/", "pages/", "scripts/", "packages/", "tests/", "docs/", ".project/", ".githooks/", ".codex/", ".github/", "package.json", "AGENTS.md", "CLAUDE.md"]
mode: once
---

# Agent progress checklist

Before significant work, read `.project/progress.json` and use an existing goal
or validate a bounded plan. Approve a new plan only after explicit user consent.
Never edit Progress JSON or Markdown directly; use MCP, or the npm fallback.

One approval for an exact bounded step covers its listed reversible edits,
documentation, Progress updates, validations, and verified commit. Do not ask
for another `go` between them. In confirmed autonomous mode, continue through
the validated, materialized steps without another `go`. Ask again for expanded
scope or an action reserved by `AGENTS.md`.

In collaborative mode, update the step and hand off up to three next steps. In
autonomous mode, solve and execute approved steps until `DONE` or a genuine
external blocker. `DONE` requires short evidence. A genuine external blocker
requires `external:` evidence; missing approval is not external and must not
change a step to `BLOCKED`. PostToolUse may report coverage but never writes
Progress. Do not create permissions, global rules, hooks, or `AGENTS.md`
automatically.
