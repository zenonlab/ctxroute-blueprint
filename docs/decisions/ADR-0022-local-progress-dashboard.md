---
scope:
  - scripts/progress-dashboard.mjs
  - scripts/progress-dashboard-app.mjs
  - scripts/progress-dashboard.html
  - scripts/progress-dashboard.css
  - scripts/progress-dashboard-client.js
  - scripts/progress-dashboard-manager.mjs
  - scripts/progress-core.mjs
  - scripts/progress-mcp.mjs
  - .codex/hooks/stop-review.mjs
  - .ctxroute/state/
  - .project/ui-design-contract.json
  - .project/sensor-baseline.json
  - docs/workflows/README.md
  - docs/architecture/src/blueprint.architecture.json
  - docs/architecture/src/traffic.dataflow.json
  - tests/progress-dashboard.test.mjs
  - tests/mcp-stdio.test.mjs
  - tests/hooks.test.mjs
review: on-change
revised: true
---

# ADR-0022 — Authenticated local Progress dashboard

- Status: accepted
- Date: 2026-09-02

## Context

Progress is durable but its JSON and generated Markdown are awkward for a
developer to inspect and update. A remote application would add identity,
hosting, synchronization, and a second data boundary that this blueprint does
not need.

## Decision

Provide a dependency-free Node.js dashboard addressed through `localhost` on
an ephemeral port. The hostname deliberately avoids pinning the implementation
to one numeric IP family; accepted Host and Origin values remain limited to
localhost and the standard IPv4/IPv6 loopback forms.

The URL carries a random token in its fragment so HTTP requests and access logs
cannot receive it. Client JavaScript copies the token into tab-scoped
`sessionStorage`, removes the fragment, and sends the token in a request header.
Reloading that tab therefore remains authenticated without persisting the token
across browser sessions. Every API request checks that token and local request
metadata; JSON bodies are bounded, responses are not cached, and a restrictive
CSP permits only bundled resources. The server writes no request logs.

All reads, validation, plan creation, edits, structural step changes, and mode
changes call `progress-core`. Responses include a hash revision and stale
mutations fail with HTTP 409. Plan creation freezes identifiers, while titles,
criteria, files, commands, evidence, status, and step structure remain editable
through explicit UI operations. Atomic validation preserves safe relative
paths, bounds, unique identifiers, one step minimum, and the `DONE` proof rule.

The dependency-free client is split into local HTML, CSS, and JavaScript
resources. Step cards are collapsed by default and provide an immediate status
select, debounced text autosave, page-local undo/redo history, numbered list
editors, mouse and keyboard ordering, inline errors, and deletion through a
focus-managed confirmation followed by a temporary restore toast. Revision
conflicts reload durable state while reapplying matching unsaved drafts.

`progress_open_dashboard` starts or reuses a detached instance and never opens
the system browser. The default instance has no idle expiration so an issued
dashboard link stays available for the project session; callers may still set
an explicit idle timeout. Ignored state under `.ctxroute/state/` records the
instance, PID, URL, token, and hashed session markers. Stop uses Codex's official
`session_id`, stays silent without unfinished work, and reports dashboard
failure without altering continuation policy. `stop_hook_active` returns before
any dashboard work to prevent recursive Stop behavior.

## Consequences

The dashboard is a local development surface, not product architecture. Its
components appear only in internal Archify sources, which remain excluded from
`all`, preview, build, and visual-check product selection. Restarting loses only
ephemeral server/session metadata; the checklist remains recoverable from
`.project/progress.json`.
