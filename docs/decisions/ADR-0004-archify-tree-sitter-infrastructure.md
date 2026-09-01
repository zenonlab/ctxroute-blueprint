---
scope:
  - docs/architecture/**
  - .githooks/archify
  - .githooks/sensor
  - package.json
  - package-lock.json
  - skills-lock.json
review: on-change
revised: true
---
# ADR-0004 — Archify and tree-sitter blueprint infrastructure

- Status: accepted
- Date: 2026-08-30

## Context

The blueprint needs executable architecture evidence and a syntax-aware safety
check without selecting a product stack. Mermaid validates syntax but does not
provide a typed, quality-gated architecture artifact. Text matching cannot
reliably distinguish executable code from comments and strings.

## Decision

Keep the project in `template` status and add two Node.js infrastructure tools.

Install the official `tt-a1i/archify` skill at tag `v2.16.0`, tag object
`fe2c0da92389bb35e9d71a9c7ae000c1083f2c37` (peeled commit
`c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de`), through the pinned `skills`
manager. Restore its ignored local copies during npm installation, verify the
pin and version, and run `archify doctor`. Version `skills-lock.json`; never
vendor or modify the upstream skill.

Store the blueprint architecture as Archify architecture JSON IR under
`docs/architecture/src/`. Validate it with the `showcase` quality profile and
generate self-contained HTML only under ignored `dist/`.
After a Linux build, run Archify `visual-check` at all four supported desktop
resolutions and publish its captures, contact sheet, and JSON receipt. Automated
containment is required; `visualReview` remains pending until human inspection.

Implement the Sensor as a short-lived Node.js CLI backed by the official
tree-sitter JavaScript, TypeScript, and Python grammars. It emits stable JSON
diagnostics and uses exit codes 0 (safe), 1 (warning), and 2 (unsafe or error).
Rules remain local configuration; upstream grammars remain unchanged.

## Alternatives

The unrelated public `archify@0.0.4` package is rejected because it is not the
official skill. Vendoring or forking Archify and the grammars would obscure
provenance and updates. Regex-only scanning cannot meet the false-positive and
syntax-error requirements.

## Consequences

Node.js 22 CI must exercise native tree-sitter bindings on Linux, macOS, and
Windows. `npm install` and `npm ci` require Git/network access to restore the
pinned skill. Archify updates are explicit: review a release, change both pins,
regenerate the lock, run doctor and all tests, then commit.

Tree-sitter remains Sensor-only. Official CRG owns its independent code graph
and context MCP as defined by ADR-0018; no AST context server is retained.
