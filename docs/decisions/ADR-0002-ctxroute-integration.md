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
- Last reviewed: 2026-09-06

## Context

The template needs relevant project rules to reach coding agents at the action
where they matter. Absolute paths in hook configuration are not reusable across
clones or operating systems.

## Decision

Install CTXRoute from the official `zenonlab/ctxroute` HTTPS archive, pinned to
a reviewed commit. Keep CTXRoute configuration and rule documents in the derived
project under the canonical `.claude/hooks/docs/` path.

Expose one project-local lifecycle dispatcher for each of the six supported
events: `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`,
`PreCompact`, and `Stop`. The dispatcher invokes only minimal mission,
governance, security, passive observation, restitution, and cleanup handlers.
CTXRoute document lookup is explicit through the orchestrator MCP or mirror
CLI; it is not injected automatically on tool events. Both agents query the
same tracked rule corpus.

Keep exactly one configured handler per event in both `.codex/hooks.json` and
`.claude/settings.json`. Run governance for mutation-capable `PreToolUse`
events, Sensor and passive audit after writes, and CTXRoute reset during
`PreCompact` and Stop.

Add a lightweight `postinstall` check. It verifies the installed CTXRoute
package, the on-demand query and reset entry points, both hook configurations, and the
Claude doctrine import. It reports one manual Codex action: open `/hooks` and
approve the six workspace definitions. It never changes Codex trust settings,
which are stored outside the repository.

Do not configure custom lifecycle status messages. Restrict `PostToolUse` to
mutation-capable tools, and skip the architecture subprocess on read-only
`PreToolUse` events. Diagnose legacy global
CTXRoute commands during `postinstall`: global and project hooks are additive,
so keeping both causes duplicate output and avoidable process startup.
The diagnostic is read-only and never rewrites user configuration.

Use `mode: once` as the project default and on every tracked guidance document.
An explicit query may deliver a matching rule once per query session, and the
existing reset clears that local session state. Blocking governance remains a
separate local hook and does not depend on context lookup.

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
the six hook entry points used by the template while incorporating the current
upstream address-consistency and mutation-runner fixes.
