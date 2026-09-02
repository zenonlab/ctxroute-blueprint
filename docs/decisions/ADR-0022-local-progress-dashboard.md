---
scope:
  - scripts/progress-dashboard.mjs
  - scripts/progress-dashboard-app.mjs
  - scripts/progress-dashboard-manager.mjs
  - scripts/progress-core.mjs
  - scripts/progress-mcp.mjs
  - .codex/hooks/stop-review.mjs
  - .ctxroute/state/
  - .project/ui-design-contract.json
  - docs/workflows/README.md
  - docs/architecture/src/blueprint.architecture.json
  - docs/architecture/src/traffic.dataflow.json
  - tests/progress-dashboard.test.mjs
  - tests/mcp-stdio.test.mjs
  - tests/hooks.test.mjs
review: on-change
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
cannot receive it. Client JavaScript removes the fragment and sends the token
in a request header. Every API request checks that token and local request
metadata; JSON bodies are bounded, responses are not cached, and a restrictive
CSP permits only bundled resources. The server writes no request logs and
stops after inactivity.

All reads, validation, approval, step updates, and mode changes call
`progress-core`. Responses include a hash revision and stale mutations fail
with HTTP 409. An approved plan's titles, criteria, files, and commands remain
immutable; only status, evidence, mode, and the existing mode-offer flag are
mutable.

`progress_open_dashboard` starts or reuses a detached instance and never opens
the system browser. Ignored state under `.ctxroute/state/` records the instance,
PID, URL, token, and hashed session markers. Stop uses Codex's official
`session_id`, stays silent without unfinished work, and reports dashboard
failure without altering continuation policy. `stop_hook_active` returns before
any dashboard work to prevent recursive Stop behavior.

## Consequences

The dashboard is a local development surface, not product architecture. Its
components appear only in internal Archify sources, which remain excluded from
`all`, preview, build, and visual-check product selection. Restarting loses only
ephemeral server/session metadata; the checklist remains recoverable from
`.project/progress.json`.
