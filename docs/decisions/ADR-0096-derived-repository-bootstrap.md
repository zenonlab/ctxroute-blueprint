---
scope:
  - .codex/hooks/pre-tool-architecture.mjs
  - tests/architecture-hook.test.mjs
  - AGENTS.md
  - README.md
review: on-change
contracts:
  - AGENTS.md
  - README.md
---
# ADR-0096 — Derived repository bootstrap

- Status: accepted
- Date: 2026-09-22

## Context

The template lifecycle requires product work to start from a derived repository,
not the `zenonlab/ctxroute-blueprint` remote. Its template-mode command
allowlist allowed clone and GitHub API access but rejected the direct GitHub CLI
command that creates a repository from the official template. This made the
documented lifecycle impossible for an authenticated agent to complete.

## Decision

Permit exactly `gh repo create <repository> --private|--public --template
zenonlab/ctxroute-blueprint`, in either order for the two flags, while project
status is `template`. Repository names are constrained to a simple owner/name
or name form. No source path, extra options, organization mutation, or arbitrary
template is allowed. Product-code writes and direct status changes remain
blocked until normal initialization completes.

## Alternatives

Requiring manual repository creation was rejected because it leaves a normal
authenticated bootstrap flow artificially blocked. Allowing all `gh repo create`
commands was rejected because it would broaden authority beyond the template's
single required derivation action.

## Consequences

Agents can complete a private or public derived-repository bootstrap without
weakening the product-code boundary. Tests must prove both accepted command
forms and rejection of missing, foreign-template, or source-based variants.
