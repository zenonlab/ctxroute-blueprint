# ADR-0002 — CTXRoute integration

- Status: accepted
- Date: 2026-08-24
- Last reviewed: 2026-08-26

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
`PreCompact`, and `Stop`. The dispatcher invokes the existing governance hooks
and CTXRoute shells sequentially, merges non-blocking output, and immediately
returns a refusal without changing its reason. Codex uses the CTXRoute Codex
shells through the portable wrapper; Claude uses CTXRoute's native Claude
shells. Both agents load the same tracked rule corpus.

Keep exactly one configured handler per event in both `.codex/hooks.json` and
`.claude/settings.json`. Run governance before context injection on
`PreToolUse`, CTXRoute validation before the local audit on `PostToolUse`, and
the turn counter before the canary on `UserPromptSubmit`.

Add a lightweight `postinstall` check. It verifies the installed CTXRoute
package, the six required entry points, both hook configurations, and the
Claude doctrine import. It reports one manual Codex action: open `/hooks` and
approve the six workspace definitions. It never changes Codex trust settings,
which are stored outside the repository.

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
