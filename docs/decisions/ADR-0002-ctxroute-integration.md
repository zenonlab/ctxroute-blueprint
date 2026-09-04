---
scope:
  - .codex/**
  - .claude/**
  - ctxroute-config.json
  - package.json
  - package-lock.json
review: on-change
revised: true
---
# ADR-0002 — CTXRoute integration

- Status: accepted
- Date: 2026-08-24
- Last reviewed: 2026-09-03

## Context

The template needs relevant project rules to reach coding agents at the action
where they matter. Absolute paths in hook configuration are not reusable across
clones or operating systems.

## Decision

Install CTXRoute from the official `zenonlab/ctxroute` HTTPS archive, pinned to
a reviewed commit. Keep CTXRoute configuration and rule documents in the derived
project under the canonical `.claude/hooks/docs/` path.

Expose one project-local lifecycle dispatcher for each of the nine supported
events: `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`,
`PreCompact`, `Stop`, `SubagentStart`, `SubagentStop`, and `SessionEnd`. The dispatcher invokes the existing governance hooks
and CTXRoute shells sequentially, merges non-blocking output, and immediately
returns a refusal without changing its reason. The dispatcher resolves both
Codex and Claude entry points directly from the project-local CTXRoute package,
avoiding a nested wrapper process. Both agents load the same tracked rule
corpus.

Keep exactly one configured handler per event in both `.codex/hooks.json` and
`.claude/settings.json`. Run governance before context injection on
`PreToolUse`, CTXRoute validation before the local audit on `PostToolUse`, and
the turn counter before the canary on `UserPromptSubmit`.

Add a lightweight `postinstall` check. It verifies the installed CTXRoute
package, the required CTXRoute entry points, both hook configurations, and the
Claude doctrine import. It reports one manual Codex action: open `/hooks` and
approve the nine workspace definitions. It never changes Codex trust settings,
which are stored outside the repository.

Do not configure custom lifecycle status messages. Restrict `PreToolUse` and
`PostToolUse` to mutation-capable tools; ordinary reads do not start the
dispatcher. Diagnose legacy global
CTXRoute commands during `postinstall`: global and project hooks are additive,
so keeping both causes duplicate progress output and avoidable process startup.
The diagnostic is read-only and never rewrites user configuration.

Use `mode: once` as the project default and on every tracked guidance document.
ADR mirrors are inactive routing indexes rather than copies of full decision
bodies. The architecture guard names only applicable ADR files and directs the
agent to read them when a mutation materially changes a boundary or contract.
Project-governance guidance resolves product architecture from
`.project/project-config.json`; it never treats the blueprint's internal
architecture as product evidence. Ecosystem-specific Sensor guidance is split
by path substring, so JavaScript package work does not receive Ruby or PHP
adapter details and each derived stack receives only relevant context.
CTXRoute receives a 1,800-character producer budget below the dispatcher's
4,096-character cap. Normal guidance is delivered in one compact frame rather
than a multi-call remainder queue. A matching rule completes delivery once per session, then becomes
eligible again only after the existing `PreCompact` reset. Blocking governance still
runs on every applicable mutation; the cadence change only removes repeated
informational context during reading and implementation loops.

## Alternatives

Global installation would make project behavior depend on each contributor's
machine. Vendoring CTXRoute would duplicate its source and complicate updates.
Absolute hook paths would break when a project is cloned elsewhere.

## Consequences

Node.js 22+ is required by the pinned CTXRoute version. A plain `npm install` or
`npm ci` installs and checks CTXRoute. `npm run setup` additionally installs the
Mermaid browser, enables repository Git hooks, and runs the full validation
suite. Tracked hook configuration works on Windows, macOS, and Linux.

Codex Cloud can install and verify CTXRoute before an agent starts, but hook
activation still depends on the workspace trust policy. The repository cannot
and must not bypass that boundary. Hook runtime failures remain fail-open and
surface a diagnostic so a broken guardrail does not silently look healthy.
Dependency updates require an explicit commit review and ADR update.

The reviewed CTXRoute pin is
`76b45a57543c940c51e382a41adb749faa44bbc4`. It preserves version 2.0.0 and
the CTXRoute hook entry points used by the template while incorporating the current
upstream address-consistency and mutation-runner fixes.
